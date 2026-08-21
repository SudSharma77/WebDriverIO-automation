import type { Platform } from "../types.js";
import type { Catalog, CatalogEntry, ReuseDecision, SpecIndex, SpecRecord } from "./types.js";

/**
 * Decide how much work a request actually needs.
 *
 * The ladder, cheapest first:
 *
 *   replayed     an existing spec covers this        0 model calls
 *   from-catalog elements are known, flow is not     1 model call
 *   explored     nothing is known                    ~15 tool calls + 2
 *
 * Everything is deterministic. Using a model to decide whether to use a model
 * would put a token cost on the cost-avoidance path, and the signals available
 * here — the prompt text, the target, the platform — are enough without one.
 */

/** Word overlap required before two prompts are considered the same scenario. */
const MATCH_THRESHOLD = 0.5;

/**
 * Opposites that word overlap cannot distinguish.
 *
 * "add a laptop to the cart" and "remove a laptop from the cart" share most of
 * their words and score above any threshold loose enough to catch genuine
 * rewordings. Replaying the wrong one of those is not a cheap mistake that
 * corrects itself: the add-to-cart spec would pass, and the run would report
 * "remove from cart — verified" for a scenario that never executed.
 *
 * So overlap decides similarity, and this decides whether similarity is
 * allowed to mean anything.
 */
const OPPOSITES: ReadonlyArray<readonly [string, string]> = [
  ["add", "remove"],
  ["add", "delete"],
  ["create", "delete"],
  ["insert", "remove"],
  ["login", "logout"],
  ["enable", "disable"],
  ["show", "hide"],
  ["open", "close"],
  ["accept", "reject"],
  ["approve", "decline"],
  ["valid", "invalid"],
  ["success", "failure"],
  ["successful", "unsuccessful"],
  ["correct", "incorrect"],
  ["empty", "full"],
  ["increase", "decrease"],
  ["expand", "collapse"],
];

export function decideReuse(args: {
  prompt: string;
  platform: Platform;
  target: string;
  specs: SpecIndex;
  catalog: Catalog;
}): ReuseDecision {
  const { prompt, platform, target, specs, catalog } = args;

  // A spec is only meaningful against the app it was verified on: the same
  // words about a different URL describe a different system.
  const candidates = specs.specs.filter((s) => s.platform === platform && s.target === target);

  const best = bestMatch(prompt, candidates);
  if (best) {
    return {
      mode: "replayed",
      spec: best.spec,
      reason:
        best.score === 1
          ? `"${best.spec.title}" already covers this exact request — replaying it instead of regenerating.`
          : `"${best.spec.title}" looks like the same scenario (${Math.round(best.score * 100)}% match) — replaying it first.`,
      known: relevantEntries(catalog, platform),
    };
  }

  const known = relevantEntries(catalog, platform);
  if (known.length > 0) {
    return {
      mode: "from-catalog",
      reason: `No spec covers this yet, but ${known.length} element${known.length === 1 ? " is" : "s are"} already known on this app — writing the spec from the catalog instead of exploring.`,
      known,
    };
  }

  return {
    mode: "explored",
    reason: "Nothing is known about this app yet — exploring it live, and saving everything learned.",
    known: [],
  };
}

interface Match {
  spec: SpecRecord;
  score: number;
}

function bestMatch(prompt: string, candidates: SpecRecord[]): Match | null {
  let best: Match | null = null;

  for (const spec of candidates) {
    if (opposed(prompt, spec.prompt)) continue;
    const score = similarity(prompt, spec.prompt);
    if (score >= MATCH_THRESHOLD && (!best || score > best.score)) best = { spec, score };
  }

  return best;
}

/** True when the two prompts describe opposite actions. */
export function opposed(a: string, b: string): boolean {
  const left = meaningfulWords(a);
  const right = meaningfulWords(b);

  return OPPOSITES.some(
    ([one, other]) =>
      (left.has(one) && right.has(other) && !left.has(other)) ||
      (left.has(other) && right.has(one) && !left.has(one)),
  );
}

/**
 * Jaccard overlap of meaningful words.
 *
 * Deliberately simple, and paired with the opposites check above rather than
 * carrying the decision alone. A false negative costs one unnecessary
 * exploration; a false positive reports an untested scenario as passing, so the
 * two are not symmetric and the tie-breaker is never "be more permissive".
 */
export function similarity(a: string, b: string): number {
  const left = meaningfulWords(a);
  const right = meaningfulWords(b);
  if (left.size === 0 || right.size === 0) return 0;

  let shared = 0;
  for (const word of left) if (right.has(word)) shared++;

  return shared / (left.size + right.size - shared);
}

/** Words that carry the scenario. Stop words would inflate every comparison. */
const STOP_WORDS = new Set([
  "a", "an", "and", "as", "at", "be", "by", "can", "for", "from", "get", "has", "have", "in", "into",
  "is", "it", "of", "on", "or", "should", "that", "the", "then", "to", "user", "verify", "check",
  "test", "with", "when", "should", "make", "sure", "able", "see", "using",
]);

function meaningfulWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 2 && !STOP_WORDS.has(word)),
  );
}

function relevantEntries(catalog: Catalog, platform: Platform): CatalogEntry[] {
  return catalog.entries
    .filter((entry) => entry.platform === platform)
    .sort((a, b) => b.lastVerified - a.lastVerified);
}

/**
 * Fold a passing run's locators into the catalog.
 *
 * A selector that changed is not overwritten silently — the old one is retired
 * into `history`, which is what makes "the login button moved in this build"
 * something the tool can report rather than something that just happens.
 */
export function mergeLocators(
  catalog: Catalog,
  locators: Array<{ label: string; selector: string }>,
  context: { platform: Platform; specFile: string; now: number },
): { catalog: Catalog; added: string[]; changed: string[] } {
  const entries = [...catalog.entries];
  const added: string[] = [];
  const changed: string[] = [];

  for (const { label, selector } of locators) {
    const index = entries.findIndex((e) => e.label === label && e.platform === context.platform);

    if (index === -1) {
      entries.push({
        label,
        selector,
        platform: context.platform,
        firstSeen: context.now,
        lastVerified: context.now,
        usedBy: [context.specFile],
        history: [],
      });
      added.push(label);
      continue;
    }

    const existing = entries[index]!;
    if (existing.selector !== selector) {
      existing.history.push({ selector: existing.selector, retiredAt: context.now });
      existing.selector = selector;
      changed.push(label);
    }
    existing.lastVerified = context.now;
    if (!existing.usedBy.includes(context.specFile)) existing.usedBy.push(context.specFile);
  }

  return { catalog: { ...catalog, entries }, added, changed };
}
