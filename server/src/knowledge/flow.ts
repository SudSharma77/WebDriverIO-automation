import type { PageFact } from "./structure.js";
import type { SpecRecord } from "./types.js";

/**
 * Spotting a shared business-function-shaped precondition across saved specs
 * — "log in" is the canonical case — without ever guessing one into
 * existence.
 *
 * A reference architecture reviewed for this feature (a client's own
 * Playwright suite, `.mcp-context/context.md`) extracts exactly this pattern
 * into a named "business function" layer, and registers it in a manifest.
 * The extraction itself is not safe to automate here: a good name needs to
 * know *what the steps mean* ("loginToOTT"), and this layer only knows *what
 * page-object methods ran*. A wrong guess would silently plant a badly-named
 * file in a client's suite — worse than surfacing the opportunity and leaving
 * the call on a human (mirrors that same reference's own rule: "the agent
 * must ask for permission... before generating or updating"). So this module
 * stops at detection; `renderFlow` in codegen.ts is what a human-approved
 * extraction would call.
 */

const MIN_SHARED_STEPS = 3;

/**
 * The ordered page-object calls a rewritten spec makes, e.g.
 * `["homePage.clickConfirmCookieBanner", "homePage.enterUseremailInput"]`.
 *
 * Only meaningful once a spec has been through `rewriteToPageObjects` — a
 * spec still full of raw selector calls has nothing here to compare, and
 * simply never becomes a match on either side of the comparison.
 */
export function extractCallSequence(code: string, pages: PageFact[]): string[] {
  const instances = new Set(pages.map((p) => instanceName(p.className)));
  if (instances.size === 0) return [];

  const pattern = new RegExp(`\\b(${[...instances].join("|")})\\.(\\w+)\\(`, "g");
  const calls: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(code))) {
    calls.push(`${match[1]}.${match[2]}`);
  }
  return calls;
}

export interface SharedPrefix {
  /** The calls in common, in order — what a promoted flow would contain. */
  steps: string[];
  /** The earlier spec this sequence was first seen in. */
  matchedSpec: SpecRecord;
}

/**
 * The longest run shared with any prior spec's start, if it clears the
 * "worth naming a function for" bar.
 *
 * Prefix-only, not a general common-subsequence search: a shared prefix means
 * two scenarios genuinely start the same way (the "login is a precondition"
 * case), which is what makes it safe to describe as one function later. A
 * shared run in the *middle* of two otherwise-different scenarios is a much
 * weaker signal — likely coincidence (both happen to click a cookie banner)
 * rather than a real shared flow — and is deliberately not surfaced.
 */
export function findSharedPrefix(
  sequence: string[],
  priorSpecs: SpecRecord[],
  minLength: number = MIN_SHARED_STEPS,
): SharedPrefix | null {
  let best: SharedPrefix | null = null;

  for (const spec of priorSpecs) {
    const other = spec.callSequence;
    if (!other || other.length === 0) continue;

    let i = 0;
    while (i < sequence.length && i < other.length && sequence[i] === other[i]) i++;
    if (i < minLength) continue;
    if (!best || i > best.steps.length) {
      best = { steps: sequence.slice(0, i), matchedSpec: spec };
    }
  }

  return best;
}

function instanceName(className: string): string {
  return className[0]!.toLowerCase() + className.slice(1);
}
