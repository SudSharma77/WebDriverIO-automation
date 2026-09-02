import fs from "node:fs/promises";
import path from "node:path";
import { SECRET_ENV_PREFIX } from "../lanes/secrets.js";
import type { Platform, RunTarget } from "../types.js";
import { extractBusinessFunctions } from "./businessFunction.js";
import { extractLocators, extractRequiredSecrets } from "./extract.js";
import { extractCallSequence, findSharedPrefix, type SharedPrefix } from "./flow.js";
import { withClientLock } from "./lock.js";
import { nestScenario } from "./nest.js";
import { finalizeImports, rewriteToPageObjects } from "./pom.js";
import { storePages, type StoredPage } from "./persist.js";
import {
  appendRunLog,
  ensureProject,
  readCatalog,
  readFlowIndex,
  readSpecIndex,
  sourceExt,
  writeCatalog,
  writeFlowIndex,
  writeSpecIndex,
  type ClientProject,
} from "./project.js";
import { decideReuse, mergeLocators } from "./reuse.js";
import { partitionByPage, slugFromUrl, slugify, type PageFact } from "./structure.js";
import type { ProjectLanguage, ReuseDecision } from "./types.js";

/**
 * The client's accumulated project, viewed from inside one lane.
 *
 * Two entry points: `openKnowledge` before any work, to find out how much work
 * is actually needed, and `recordSuccess` after a spec passes, to fold what was
 * learned back in. Everything between them is unchanged exploration.
 */

export interface KnowledgeSession {
  project: ClientProject;
  decision: ReuseDecision;
  /** Source of the spec to replay, when one matched. */
  replaySpec?: string;
  /** Credentials that spec expects, so a missing one is caught before launch. */
  missingSecrets: string[];
}

export function targetOf(target: RunTarget, platform: Platform): string {
  if (platform === "web") return target.webUrl ?? "";
  return (platform === "android" ? target.androidApp : target.iosApp) ?? "";
}

export async function openKnowledge(args: {
  clientId: string;
  prompt: string;
  platform: Platform;
  target: RunTarget;
  availableSecrets: string[];
}): Promise<KnowledgeSession> {
  const project = await ensureProject(args.clientId);
  const [specs, catalog] = await Promise.all([readSpecIndex(project), readCatalog(project)]);

  const decision = decideReuse({
    prompt: args.prompt,
    platform: args.platform,
    target: targetOf(args.target, args.platform),
    specs,
    catalog,
  });

  if (decision.mode !== "replayed" || !decision.spec) {
    return { project, decision, missingSecrets: [] };
  }

  const missingSecrets = decision.spec.requiresSecrets.filter((name) => !args.availableSecrets.includes(name));

  // A spec that reads a credential nobody supplied would fail on replay for a
  // reason that has nothing to do with the app. Fall back to generating rather
  // than reporting a false failure against the client's build.
  if (missingSecrets.length > 0) {
    return {
      project,
      decision: {
        ...decision,
        mode: "explored",
        reason: `"${decision.spec.title}" covers this, but it needs ${missingSecrets.join(", ")}, which this run did not supply — generating instead.`,
      },
      missingSecrets,
    };
  }

  const replaySpec = await readSpec(project, decision.spec.file);
  if (!replaySpec) {
    return {
      project,
      decision: { ...decision, mode: "explored", reason: `"${decision.spec.file}" is indexed but missing from disk — regenerating it.` },
      missingSecrets: [],
    };
  }

  return { project, decision, replaySpec, missingSecrets: [] };
}

export interface SaveReport {
  specFile: string;
  pages: StoredPage[];
  locatorsAdded: string[];
  locatorsChanged: string[];
  reusedExistingSpec: boolean;
  /** True when this scenario landed as a new it() inside an already-saved spec. */
  addedToExistingSpec: boolean;
  /** True when the saved spec calls page-object methods rather than raw selectors. */
  usesPageObjects: boolean;
  /**
   * What happened to the business-function layer for this scenario: a flow
   * written, an existing one reused, or an extraction rolled back because the
   * lifted spec did not replay.
   */
  flow?: {
    /** Every flow this spec now calls, whether newly written or reused. */
    names: string[];
    applied: boolean;
    /** Those that already existed; nothing new was written for them. */
    reused?: string[];
    /** The lifted spec was replayed and passed. */
    verified?: boolean;
    /** New flows that delegate their opening steps to one that already existed. */
    composedFrom?: Array<{ name: string; steps: number }>;
    /** Why it was not applied. */
    reason?: string;
  };
  /**
   * A run of steps this scenario opens with that a prior spec also opens
   * with — surfaced when it was not acted on automatically, so a human can
   * decide whether it deserves a name.
   */
  flowSuggestion?: { steps: number; sharedWithFile: string; sharedWithTitle: string };
  /**
   * Set by the lane, not by this function — `recordSuccess` only knows about
   * the local project, never about a client's linked repo. Declared here so
   * the shape lane.ts builds on top of the return value is one type, not two.
   */
  repoSync?: { pushed: boolean; branch: string; error?: string; awaitingReview?: string };
}

/**
 * The file a new (non-replayed) scenario belongs in.
 *
 * Named after the page it exercises, not the scenario's own wording — two
 * prompts against the same page land in the same file as siblings, the way
 * `partitionByPage` already groups their page objects.
 *
 * Web only: an app path (`C:\apps\demo.apk`) or a cloud app id (`bs://a1b2c3`)
 * both parse as syntactically valid URLs — a bare custom scheme with an empty
 * path — so `slugFromUrl` would happily return "home" for every one of them
 * and silently merge every mobile scenario in the run into one file. Mobile
 * has no real page concept to group by (see `partitionByPage`), so it keeps
 * today's one-file-per-scenario naming, gated on platform rather than on
 * whether the string happens to parse.
 */
/**
 * The feature-area name a scenario belongs to, independent of what kind of
 * file it lands in — `categoryFile` uses it for the spec, `liftIntoFlow` uses
 * the same one for the grouped business-function file, so `login.web.spec.ts`
 * and `login-bfs.ts` always pair up rather than drifting apart under two
 * different naming schemes.
 */
export function categorySlug(target: string, title: string, platform: Platform): string {
  const slug = platform === "web" ? slugFromUrl(target) : null;
  return slug ?? slugify(title);
}

export function categoryFile(target: string, title: string, platform: Platform, language: ProjectLanguage = "js"): string {
  return `${categorySlug(target, title, platform)}.${platform}.spec${sourceExt(language)}`;
}

/** `login.web.spec.js` -> `login-2.web.spec.js`, `login-3.web.spec.js`, ... */
export function fallbackName(category: string): (n: number) => string {
  const dot = category.indexOf(".");
  const [base, ext] = dot === -1 ? [category, ""] : [category.slice(0, dot), category.slice(dot)];
  return (n: number) => `${base}-${n}${ext}`;
}

export interface RecordSuccessArgs {
  session: KnowledgeSession;
  runId: string;
  spec: string;
  title: string;
  prompt: string;
  platform: Platform;
  target: RunTarget;
  /**
   * Replay a candidate spec and say whether it still passes.
   *
   * Supplied by the lane, which owns the runner; the knowledge layer has no
   * business starting a browser. Lifting the steps into a business function
   * splits one file into two and rewrites its assertions, and a spec that
   * passed flat is not proof the lifted version passes — so the lift is only
   * kept if this says so, and rolled back if it does not.
   *
   * Absent only where no runner exists (tests). Extraction still happens
   * there, and the report says it was unverified.
   */
  verifyExtraction?: (spec: string, specFile: string) => Promise<boolean>;
}

/**
 * Fold a passing run into the client's project.
 *
 * Only ever called after a green replay. Saving a spec that has not passed
 * would fill the client's suite with tests that fail for reasons nobody has
 * looked at, which is worse than having no suite.
 *
 * Serialized per client, and the whole body is the critical section rather
 * than each individual write: the spec file, the page objects, the catalog and
 * the spec index are read-modify-write against shared state, and a partial
 * interleaving would leave them describing different runs. The three platform
 * lanes of a single run reach here in parallel (`orchestrator.ts`), so this is
 * the ordinary path, not an edge case.
 */
export async function recordSuccess(args: RecordSuccessArgs): Promise<SaveReport> {
  return withClientLock(args.session.project.clientId, () => saveIntoProject(args));
}

async function saveIntoProject(args: RecordSuccessArgs): Promise<SaveReport> {
  const { project } = args.session;
  const now = Date.now();
  const target = targetOf(args.target, args.platform);
  const reused = args.session.decision.mode === "replayed";

  let specFile: string;
  let addedToExistingSpec = false;
  // The full raw text now saved under `specFile` - for a nested save this is
  // both scenarios spliced together, not just this run's own addition. Page
  // objects, locators and the page-object rewrite below all need to see the
  // whole file: an element only the *other* scenario touches still has to be
  // known for the rewrite to recognise every call in the file, not only the
  // one just added.
  let rawWritten: string;

  if (reused) {
    specFile = args.session.decision.spec!.file;
    rawWritten = args.spec;
  } else {
    const category = categoryFile(target, args.title, args.platform, project.language);
    const existingText = await readSpec(project, category);

    if (!existingText) {
      specFile = category;
      rawWritten = args.spec;
      await fs.writeFile(path.join(project.specsDir, specFile), rawWritten, "utf8");
    } else {
      const spliced = nestScenario(existingText, args.spec);

      if (spliced) {
        specFile = category;
        addedToExistingSpec = true;
        rawWritten = spliced;
        await fs.writeFile(path.join(project.specsDir, specFile), rawWritten, "utf8");
      } else {
        // The existing file isn't shaped the way synth writes it — most likely
        // a human has since edited it by hand. Fall back to a separate file
        // rather than guess at a splice that could corrupt or silently drop
        // what's already there; "additive, never rewrite an edited file" is
        // the same promise the page objects and selectors already keep.
        const next = fallbackName(category);
        let n = 2;
        specFile = next(n);
        while (await readSpec(project, specFile)) {
          n += 1;
          specFile = next(n);
        }
        rawWritten = args.spec;
        await fs.writeFile(path.join(project.specsDir, specFile), rawWritten, "utf8");
      }
    }
  }

  const pages = partitionByPage(rawWritten, args.platform, args.title);
  const stored = await storePages(project, pages);

  // Deterministic, not a model call: every page-object method is a one-line
  // wrapper around the identical helper call, so this is safe to run even on
  // a replayed file (a no-op there — nothing changed since it was last
  // written) or a re-saved nested file (idempotent — an already-rewritten
  // call doesn't match the raw-call pattern a second time).
  let usesPageObjects = false;
  let finalCode = rawWritten;
  if (!reused) {
    const rewrite = rewriteToPageObjects(rawWritten, pages);
    if (rewrite && rewrite.pagesUsed.length > 0) {
      const rewritten = finalizeImports(rewrite.code, rewrite.pagesUsed);
      if (rewritten !== rawWritten) {
        await fs.writeFile(path.join(project.specsDir, specFile), rewritten, "utf8");
        finalCode = rewritten;
        usesPageObjects = true;
      }
    }
  }

  // Lift the steps into named business functions, so the spec reads as the
  // scenario and the steps become reusable. Runs on nested files too: each
  // `it()` is lifted independently, so a second scenario added to an existing
  // file gets the same treatment the first one did rather than being left as
  // the odd one out.
  const flow =
    !reused && usesPageObjects
      ? await liftIntoFlow({
          project,
          specFile,
          spec: finalCode,
          pages,
          categoryFile: `${categorySlug(target, args.title, args.platform)}-bfs`,
          verify: args.verifyExtraction,
        })
      : null;
  if (flow?.applied) finalCode = flow.spec;

  // Only for a scenario that landed in a file of its own: `finalCode` is one
  // `it()` block there, so the call order read off it is unambiguous. A
  // nested addition shares a file with whatever else is already in it, and
  // extracting just its own calls from the merged text isn't reliable enough
  // to build a comparison on — skipped rather than risk a false match.
  //
  // Read off the page-object form rather than the flow-calling one: once the
  // steps move into a flow the spec has a single call in it, and that is not
  // a sequence anything can be compared against.
  const callSequence =
    !reused && !addedToExistingSpec ? (flow?.callSequence ?? extractCallSequence(finalCode, pages)) : undefined;

  const catalog = await readCatalog(project);
  const merged = mergeLocators(catalog, extractLocators(rawWritten), {
    platform: args.platform,
    specFile,
    now,
  });
  await writeCatalog(project, merged.catalog);

  // Replaying an earlier scenario re-verifies its own index record (matched
  // on the file AND that record's original prompt, not this run's - a replay
  // can be triggered by a rewording that scores as the same scenario, and
  // that rewording must not fork off a second record for the same file). Any
  // other outcome - a fresh file, or a new scenario nested into one - is
  // recorded under its own prompt, alongside whatever else already shares
  // that file.
  const indexedPrompt = reused ? args.session.decision.spec!.prompt : args.prompt;

  const index = await readSpecIndex(project);

  // Computed against what was on disk *before* this run's own record joins
  // it, and only from specs with a callSequence of their own (see above) —
  // other platforms, and anything nested or replayed, are silently excluded
  // as candidates rather than compared.
  let shared: SharedPrefix | null = null;
  if (callSequence && callSequence.length > 0) {
    const candidates = index.specs.filter((s) => s.platform === args.platform && s.file !== specFile);
    shared = findSharedPrefix(callSequence, candidates);
  }

  const existing = index.specs.find((s) => s.file === specFile && s.prompt === indexedPrompt);
  if (existing) {
    existing.lastVerified = now;
    existing.passCount += 1;
    if (callSequence) existing.callSequence = callSequence;
  } else {
    index.specs.push({
      file: specFile,
      prompt: args.prompt,
      title: args.title,
      platform: args.platform,
      target,
      createdAt: now,
      lastVerified: now,
      passCount: 1,
      requiresSecrets: extractRequiredSecrets(args.spec, SECRET_ENV_PREFIX),
      ...(callSequence ? { callSequence } : {}),
    });
  }
  await writeSpecIndex(project, index);

  const flowSuggestion = shared
    ? { steps: shared.steps.length, sharedWithFile: shared.matchedSpec.file, sharedWithTitle: shared.matchedSpec.title }
    : undefined;

  await appendRunLog(project, {
    at: new Date(now).toISOString(),
    runId: args.runId,
    platform: args.platform,
    mode: args.session.decision.mode,
    prompt: args.prompt,
    spec: specFile,
    target,
    pagesTouched: stored.map((p) => p.className),
    locatorsChanged: merged.changed,
  });

  return {
    specFile,
    pages: stored,
    locatorsAdded: merged.added,
    locatorsChanged: merged.changed,
    reusedExistingSpec: reused,
    addedToExistingSpec,
    usesPageObjects,
    ...(flow?.report ? { flow: flow.report } : {}),
    // Only worth surfacing when nothing was done about it — once the steps
    // are in a flow, or delegated to one, the suggestion is already acted on.
    ...(flowSuggestion && !flow?.applied ? { flowSuggestion } : {}),
  };
}

interface LiftResult {
  /** Whether the spec on disk is now the flow-calling one. */
  applied: boolean;
  spec: string;
  callSequence?: string[];
  report: SaveReport["flow"];
}

/**
 * Move a verified scenario's steps into `src/flows`, and point the spec at
 * them.
 *
 * Everything here is reversible on purpose. The spec that arrived has already
 * passed a real replay; the lifted one has not, and shipping an unverified
 * rewrite of a passing test would trade the one guarantee this whole pipeline
 * exists to make. So the lifted form is written, replayed, and kept only if it
 * is still green — otherwise the flat spec goes back exactly as it was and the
 * run reports why.
 */
async function liftIntoFlow(args: {
  project: ClientProject;
  specFile: string;
  spec: string;
  pages: PageFact[];
  /** Basename (no extension) of the grouped file new flows for this scenario's category land in. */
  categoryFile: string;
  verify?: (spec: string, specFile: string) => Promise<boolean>;
}): Promise<LiftResult | null> {
  const { project } = args;
  const index = await readFlowIndex(project);

  const extracted = extractBusinessFunctions({
    spec: args.spec,
    pages: args.pages,
    language: project.language,
    existingFlows: index.flows,
    categoryFile: args.categoryFile,
  });
  if (!extracted) return null;

  const specPath = path.join(project.specsDir, args.specFile);
  const ext = sourceExt(project.language);

  // Several flows in one run can share a category file, so this tracks each
  // *unique path's* content from before this run touched it at all — not
  // per-flow — so a rollback undoes every flow this run added to that file in
  // one step, rather than partially unwinding it flow by flow.
  const originalContent = new Map<string, string | null>();
  await fs.mkdir(project.flowsDir, { recursive: true });

  for (const flow of extracted.flows) {
    if (!flow.source) continue;
    const flowPath = path.join(project.flowsDir, `${flow.file}${ext}`);

    if (!originalContent.has(flowPath)) {
      originalContent.set(flowPath, await fs.readFile(flowPath, "utf8").catch(() => null));
    }

    const current = await fs.readFile(flowPath, "utf8").catch(() => null);
    // A function this file already exports under the name this flow wants is
    // a real collision (not the reuse case — that never has a `source` to
    // write) — declined the same way an occupied path always has been here.
    const newName = /export\s+async\s+function\s+(\w+)/.exec(flow.source)?.[1];
    if (current && newName && new RegExp(`export\\s+async\\s+function\\s+${escapeRegExp(newName)}\\b`).test(current)) {
      return null;
    }

    await fs.writeFile(flowPath, current === null ? flow.source : mergeFlowModule(current, flow.source), "utf8");
  }

  await fs.writeFile(specPath, extracted.spec, "utf8");

  const verified = args.verify ? await args.verify(extracted.spec, args.specFile) : null;
  const names = extracted.flows.map((f) => f.name);

  if (verified === false) {
    // Put it back exactly as it was, and take the flows with it — a flow no
    // spec calls is worse than no flow at all. Restoring each touched path to
    // its pre-run content (rather than deleting it outright) is what keeps
    // this safe when the path was an existing file this run only added to.
    await fs.writeFile(specPath, args.spec, "utf8");
    for (const [flowPath, previous] of originalContent) {
      if (previous === null) await fs.rm(flowPath, { force: true });
      else await fs.writeFile(flowPath, previous, "utf8");
    }
    return {
      applied: false,
      spec: args.spec,
      report: { names, applied: false, reason: "the extracted form did not pass replay" },
    };
  }

  for (const flow of extracted.flows) {
    if (flow.source) {
      index.flows.push({
        name: flow.name,
        file: `${flow.file}${ext}`,
        callSequence: flow.callSequence,
        inputFields: flow.inputFields,
        outputFields: flow.outputFields,
        usedBy: [args.specFile],
        createdAt: Date.now(),
      });
      continue;
    }
    const reused = index.flows.find((f) => f.name === flow.name);
    if (reused && !reused.usedBy.includes(args.specFile)) reused.usedBy.push(args.specFile);
  }
  await writeFlowIndex(project, index);

  const composed = extracted.flows.flatMap((f) => (f.composedFrom ? [f.composedFrom] : []));

  return {
    applied: true,
    spec: extracted.spec,
    // The sequence of the scenario this run added, which is the last one in
    // the file — earlier blocks belong to earlier runs.
    callSequence: extracted.flows[extracted.flows.length - 1]?.callSequence,
    report: {
      names,
      applied: true,
      reused: extracted.flows.filter((f) => f.reusedExisting).map((f) => f.name),
      verified: verified === true,
      ...(composed.length > 0 ? { composedFrom: composed } : {}),
    },
  };
}

/**
 * Add one flow's source to a grouped business-function file that already has
 * others in it.
 *
 * Import lines are deduplicated by exact text match rather than merged
 * token-by-token the way `nest.ts` merges the framework import: every flow
 * module imports the same fixed `step` from `@testlab/framework` and an
 * identically-formed line per page object (see `renderFlowModule`), so two
 * flows sharing a page produce byte-identical import lines — nothing to
 * reconcile beyond dropping the duplicate. The name-collision case that a
 * token-level merge would otherwise need to handle is checked separately by
 * the caller, before this is reached.
 */
function mergeFlowModule(existing: string, addition: string): string {
  const IMPORT_LINE = /^import\s.+;$/gm;
  const imports = [...new Set([...(existing.match(IMPORT_LINE) ?? []), ...(addition.match(IMPORT_LINE) ?? [])])].sort();

  const strip = (text: string) => text.replace(IMPORT_LINE, "").replace(/^\s+/, "");
  return `${imports.join("\n")}\n\n${strip(existing).trimEnd()}\n\n${strip(addition)}`;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Where a spec is verified.
 *
 * Inside the client's project, in a staging directory at the same depth as
 * `test/specs`, so relative imports of page objects resolve identically before
 * and after the spec is accepted. Only a passing spec is moved into the suite,
 * which keeps failed attempts out of the client's repository entirely.
 */
export function stagingWorkspace(project: ClientProject, specName: string) {
  return { dir: project.metaDir, specDir: "pending", specName };
}

export async function clearStaging(project: ClientProject): Promise<void> {
  await fs.rm(path.join(project.metaDir, "pending"), { recursive: true, force: true });
}

async function readSpec(project: ClientProject, file: string): Promise<string | null> {
  try {
    return await fs.readFile(path.join(project.specsDir, file), "utf8");
  } catch {
    return null;
  }
}
