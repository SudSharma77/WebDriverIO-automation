import { config } from "../config.js";
import { bindSecretsInSpec, unbindSecretsInSpec } from "../lanes/secrets.js";
import { digestDom } from "./domDigest.js";
import { lintSpec } from "./lint.js";
import { shrinkTranscript } from "./llm/budget.js";
import { llm, llmFallback, llmSecondary } from "./llm/index.js";
import type { CompleteTurn, LlmProvider, TokenUsage } from "./llm/types.js";
import { addUsage, emptyUsage } from "./llm/types.js";
import {
  EXTEND_SCAFFOLD_SYSTEM,
  FAILURE_SUMMARY_SYSTEM,
  SCAFFOLD_SYSTEM,
  fenceFor,
  synthSystem,
  extendScaffoldTask,
  extendSynthTask,
  failureSummaryTask,
  scaffoldTask,
  synthTask,
} from "./prompts.js";
import type { ProjectLanguage } from "../knowledge/types.js";
import type { LanePlan } from "../lanes/capabilities.js";
import type { Platform } from "../types.js";

export interface SynthArgs {
  prompt: string;
  platform: Platform;
  plan: LanePlan;
  transcript: string;
  recorded: string | null;
  /** What the client's project is written in. Decides the file asked for and the fence. */
  language?: ProjectLanguage;
  /** Told about each timeout-triggered retry, so the run log isn't silent about why it's slow. */
  onRetry?: (note: string) => void;
  /** Set internally by withTimeoutRetry once it falls back to the secondary provider. */
  provider?: LlmProvider;
  /** Fired after every successful API response, tagged with which provider served it - independent of whether the overall call ultimately succeeds. */
  onProviderUsage?: (provider: string, usage: TokenUsage) => void;
}

/**
 * Two-phase generation: structure the scenario into a fixed plan first, then
 * implement that plan as code. This is what makes a one-line prompt and a
 * paragraph-long one produce equally structured specs — the plan step is the
 * same fixed template either way, rather than the code model free-associating
 * structure straight out of a possibly-terse transcript.
 *
 * Wrapped in a timeout retry (see withTimeoutRetry below): a gateway that
 * times out on this call but not on explore's much smaller ones may simply be
 * unable to answer in time at this size, regardless of how small it already
 * is — cutting the transcript further and trying again costs one more call,
 * not the whole run.
 */
export async function synthesizeSpec(args: SynthArgs): Promise<{ code: string; usage: TokenUsage }> {
  return withTimeoutRetry("synthesize", args, synthesizeSpecOnce);
}

async function synthesizeSpecOnce(args: SynthArgs): Promise<{ code: string; usage: TokenUsage }> {
  let usage = emptyUsage();

  const scaffoldResult = await generateScaffold(args);
  usage = addUsage(usage, scaffoldResult.usage);
  const scaffold = scaffoldResult.scaffold;

  const first = await complete(
    synthSystem(args.language),
    [{ role: "user", text: synthTask({ ...args, scaffold }) }],
    args.provider,
    args.onProviderUsage,
  );
  usage = addUsage(usage, first.usage);
  let code = guardSpec(extractCode(first.text));

  // Deterministic quality gate: a prose rule in SYNTH_SYSTEM can be ignored: a
  // lint rule can't be. eslint-plugin-wdio's rules aren't auto-fixable, so a
  // real hit (most commonly a missing `await` before `expect(...)`, which
  // silently never actually asserts anything) gets one targeted repair call.
  const lint = await lintSpec(code, args.language);
  if (lint.issues.length > 0) {
    const fixed = await fixLintIssues({ ...args, spec: code, scaffold, issues: lint.issues });
    usage = addUsage(usage, fixed.usage);
    code = fixed.code;
  }

  // Bound after linting and before the header: the lint pass and the model both
  // see `{{PASSWORD}}`, and the rewrite only ever touches code, never the plan
  // comment that gets prepended next.
  return { code: withScaffoldHeader(bindSecretsInSpec(code), scaffold), usage };
}

export interface ExtendArgs {
  additionalPrompt: string;
  platform: Platform;
  plan: LanePlan;
  /** Transcript of the ADDITIONAL exploration only, not the original scenario's. */
  transcript: string;
  recorded: string | null;
  /** The base run's full spec, including its scaffold header. */
  existingCode: string;
  language?: ProjectLanguage;
  /** Told about each timeout-triggered retry, so the run log isn't silent about why it's slow. */
  onRetry?: (note: string) => void;
  /** Set internally by withTimeoutRetry once it falls back to the secondary provider. */
  provider?: LlmProvider;
  /** Fired after every successful API response, tagged with which provider served it - independent of whether the overall call ultimately succeeds. */
  onProviderUsage?: (provider: string, usage: TokenUsage) => void;
}

/**
 * Builds on an already-passing spec instead of regenerating one from
 * scratch. The token saving is structural, not cosmetic: the original steps
 * never re-enter an LLM call as input, because the original plan and code
 * are given as fixed context the model must not repeat, not text it has to
 * re-derive or re-emit reasoning about.
 */
export async function extendSpec(args: ExtendArgs): Promise<{ code: string; usage: TokenUsage }> {
  return withTimeoutRetry("extend", args, extendSpecOnce);
}

async function extendSpecOnce(args: ExtendArgs): Promise<{ code: string; usage: TokenUsage }> {
  let usage = emptyUsage();

  const originalScaffold = extractScaffoldHeader(args.existingCode);
  if (!originalScaffold) {
    throw new Error("The base spec has no structured-plan header to extend from — it may predate the structure phase.");
  }
  // Shown back to the model as context, so it must carry placeholders rather
  // than the env reads the binder left behind — otherwise the model copies
  // `process.env.…` forward and guardSpec rejects its own output.
  const existingCode = unbindSecretsInSpec(stripScaffoldHeader(args.existingCode));

  const scaffoldDelta = await complete(
    EXTEND_SCAFFOLD_SYSTEM,
    [{ role: "user", text: extendScaffoldTask({ ...args, originalScaffold }) }],
    args.provider,
    args.onProviderUsage,
  );
  usage = addUsage(usage, scaffoldDelta.usage);
  const newSteps = scaffoldDelta.text.trim();
  if (!newSteps) throw new Error("The model returned no additional plan steps.");

  const mergedScaffold = `${originalScaffold}\n${newSteps}`;

  const first = await complete(
    synthSystem(args.language),
    [{ role: "user", text: extendSynthTask({ ...args, mergedScaffold, existingCode }) }],
    args.provider,
    args.onProviderUsage,
  );
  usage = addUsage(usage, first.usage);
  let code = guardSpec(extractCode(first.text));

  const lint = await lintSpec(code, args.language);
  if (lint.issues.length > 0) {
    const fixed = await fixExtendLintIssues({ ...args, mergedScaffold, existingCode, spec: code, issues: lint.issues });
    usage = addUsage(usage, fixed.usage);
    code = fixed.code;
  }

  return { code: withScaffoldHeader(bindSecretsInSpec(code), mergedScaffold), usage };
}

async function fixExtendLintIssues(
  args: ExtendArgs & { mergedScaffold: string; existingCode: string; spec: string; issues: string[] },
): Promise<{ code: string; usage: TokenUsage }> {
  const result = await complete(
    synthSystem(args.language),
    [
      { role: "user", text: extendSynthTask(args) },
      { role: "assistant", text: "```" + fenceFor(args.language ?? "js") + "\n" + args.spec + "\n```" },
      {
        role: "user",
        text: [
          "A deterministic lint pass (eslint-plugin-wdio) found real issues in that file:",
          "",
          args.issues.map((i) => `- ${i}`).join("\n"),
          "",
          `Fix ONLY these issues — do not change the plan, the selectors, or the assertions otherwise. Emit the corrected full file in one \`\`\`${fenceFor(args.language ?? "js")} block, nothing else.`,
        ].join("\n"),
      },
    ],
    args.provider,
    args.onProviderUsage,
  );
  return { code: guardSpec(extractCode(result.text)), usage: result.usage };
}

function stripScaffoldHeader(code: string): string {
  return code.replace(/^\/\*\*\n[\s\S]*?\n \*\/\n/, "").trimStart();
}

async function fixLintIssues(
  args: SynthArgs & { spec: string; scaffold: string; issues: string[] },
): Promise<{ code: string; usage: TokenUsage }> {
  const result = await complete(
    synthSystem(args.language),
    [
      { role: "user", text: synthTask(args) },
      { role: "assistant", text: "```" + fenceFor(args.language ?? "js") + "\n" + args.spec + "\n```" },
      {
        role: "user",
        text: [
          "A deterministic lint pass (eslint-plugin-wdio) found real issues in that file:",
          "",
          args.issues.map((i) => `- ${i}`).join("\n"),
          "",
          `Fix ONLY these issues — do not change the plan, the selectors, or the assertions otherwise. Emit the corrected full file in one \`\`\`${fenceFor(args.language ?? "js")} block, nothing else.`,
        ].join("\n"),
      },
    ],
    args.provider,
    args.onProviderUsage,
  );
  return { code: guardSpec(extractCode(result.text)), usage: result.usage };
}

async function generateScaffold(args: SynthArgs): Promise<{ scaffold: string; usage: TokenUsage }> {
  const result = await complete(
    SCAFFOLD_SYSTEM,
    [{ role: "user", text: scaffoldTask(args) }],
    args.provider,
    args.onProviderUsage,
  );
  const scaffold = result.text.trim();
  if (!scaffold) throw new Error("The model returned no structured plan.");
  return { scaffold, usage: result.usage };
}

/** Bakes the plan into the file as a comment, so the structure is visible in the artifact itself, not just in a log somewhere. */
function withScaffoldHeader(code: string, scaffold: string): string {
  const body = scaffold
    .split("\n")
    .map((line) => (line ? ` * ${line}` : " *"))
    .join("\n");
  return `/**\n${body}\n */\n${code}`;
}

/**
 * One repair attempt against the real replay failure.
 *
 * Exploration proves the flow works interactively; replay is a different
 * process with a cold session, so the usual failures are timing and startup
 * state, not logic. Feeding back the actual runner output fixes most of them.
 * Capped at one attempt - beyond that the spec is wrong in a way a human
 * should look at, and silent retries just burn device minutes.
 */
export async function repairSpec(
  args: SynthArgs & { spec: string; failure: string; domSnapshot?: string },
): Promise<{ code: string; usage: TokenUsage }> {
  return withTimeoutRetry("repair", args, repairSpecOnce);
}

async function repairSpecOnce(
  args: SynthArgs & { spec: string; failure: string; domSnapshot?: string },
): Promise<{ code: string; usage: TokenUsage }> {
  let usage = emptyUsage();

  const parts = [
    "That spec failed when replayed by the WebdriverIO runner. Output from the run:",
    "",
    "```",
    args.failure.slice(-6000),
    "```",
  ];

  if (args.domSnapshot) {
    parts.push(
      "",
      "What was actually on the page at the moment of failure. If the element the failing step expected does not appear below, it does not exist on this screen — change the assertion to something that IS here rather than waiting longer for something that will never arrive:",
      digestDom(args.domSnapshot),
    );
  }

  parts.push(
    "",
    "Fix the spec so it passes on a cold session. Common causes: an element that needs waitForDisplayed before interaction, a step that assumed state left behind by the exploratory session, or a selector that was observed after a scroll that the spec never performs. Use the DOM snapshot above (if present) to confirm which of these actually happened rather than guessing.",
    `Keep the same plan, the same scenario, and the same assertions — fix the implementation, not the structure. Emit the corrected full file (including its structured-plan comment header, unchanged) in one \`\`\`${fenceFor(args.language ?? "js")} block, nothing else.`,
  );

  // The plan already lives in the header this file was generated with (see
  // withScaffoldHeader) - reuse it rather than re-running the structure phase,
  // which could quietly change the plan mid-repair.
  let scaffold = extractScaffoldHeader(args.spec);
  if (!scaffold) {
    const generated = await generateScaffold(args);
    usage = addUsage(usage, generated.usage);
    scaffold = generated.scaffold;
  }

  const result = await complete(
    synthSystem(args.language),
    [
      { role: "user", text: synthTask({ ...args, scaffold }) },
      { role: "assistant", text: "```" + fenceFor(args.language ?? "js") + "\n" + unbindSecretsInSpec(args.spec) + "\n```" },
      { role: "user", text: parts.join("\n") },
    ],
    args.provider,
    args.onProviderUsage,
  );
  usage = addUsage(usage, result.usage);

  return { code: bindSecretsInSpec(guardSpec(extractCode(result.text))), usage };
}

function extractScaffoldHeader(code: string): string | null {
  const match = /^\/\*\*\n([\s\S]*?)\n \*\//.exec(code.trimStart());
  if (!match) return null;
  return match[1]!
    .split("\n")
    .map((line) => line.replace(/^ \* ?/, ""))
    .join("\n")
    .trim();
}

/**
 * One plain sentence explaining a genuinely failed lane (post-repair) - for
 * scanning a list of results, especially a bulk batch, without opening the
 * full verify log for each one. Best-effort: never let this call's own
 * failure hide the real one from the user.
 */
export async function summarizeFailure(args: {
  prompt: string;
  failure: string;
  domSnapshot?: string;
}): Promise<{ summary: string | null; usage: TokenUsage }> {
  try {
    // Same reasoning as the repair pass: raw page source is mostly <head>, so
    // the summary would be written without ever seeing the screen.
    const digested = args.domSnapshot ? digestDom(args.domSnapshot) : undefined;
    const result = await complete(FAILURE_SUMMARY_SYSTEM, [
      { role: "user", text: failureSummaryTask({ ...args, domSnapshot: digested }) },
    ]);
    return { summary: result.text.trim() || null, usage: result.usage };
  } catch {
    return { summary: null, usage: emptyUsage() };
  }
}

// Kept low: today's evidence is that shrinking the transcript further does not
// help a primary provider that 504s regardless of size (tested down to ~12%
// of the original with no change in outcome) - so a couple of quick retries
// against transient blips is worth it, but burning many minutes on repeated
// shrink attempts against a backend that's proven not to respond isn't.
// llmSecondary (below) is the real answer to a primary that's just down.
const MAX_TIMEOUT_RETRIES = 1;

/**
 * A gateway timeout (504, or a plain connection timeout), or a response that
 * came back with nothing usable in it — both point at a flaky backend rather
 * than a wrong request, so a retry (smaller, or just another attempt) is
 * worth one more call. A 4xx or a genuine parse/validation failure is not
 * included here: those mean the request itself is wrong, and shrinking the
 * transcript further would not fix them.
 */
function isRetryable(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /\b50[0-9]\b|gateway time-?out|\btimed?[\s-]?out\b|connection error|ETIMEDOUT|ECONNRESET|ECONNREFUSED|returned no (structured plan|spec code|additional plan steps)/i.test(
    message,
  );
}

/**
 * Retries a synth/repair/extend call with a progressively shorter transcript
 * on a timeout, instead of failing the whole run on the first slow response.
 * Generic over the arg shape so synthesizeSpec, repairSpec and extendSpec can
 * all share one retry policy rather than three copies of the same loop.
 *
 * Once the primary provider's own retries are exhausted, makes exactly one
 * more attempt against llmSecondary (if configured) — with the *original*,
 * unshrunk transcript, since a different provider isn't known to share
 * whatever limitation the primary hit. `label` only affects the log wording.
 */
async function withTimeoutRetry<
  A extends { transcript: string; provider?: LlmProvider; onRetry?: (note: string) => void },
  R,
>(label: string, args: A, run: (args: A) => Promise<R>): Promise<R> {
  let attemptArgs = args;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await run(attemptArgs);
    } catch (err) {
      if (!isRetryable(err)) throw err;

      if (attempt < MAX_TIMEOUT_RETRIES) {
        args.onRetry?.(
          `${label} call failed (timeout or empty response); retrying with a shorter transcript (attempt ${attempt + 1}/${MAX_TIMEOUT_RETRIES})`,
        );
        attemptArgs = { ...attemptArgs, transcript: shrinkTranscript(args.transcript, 2 ** -(attempt + 1)) };
        continue;
      }

      if (llmSecondary && attemptArgs.provider !== llmSecondary) {
        args.onRetry?.(
          `${label} still failing on the primary provider after ${MAX_TIMEOUT_RETRIES + 1} attempt(s); falling back to ${llmSecondary.id} for this step`,
        );
        attemptArgs = { ...args, provider: llmSecondary };
        continue;
      }

      throw err;
    }
  }
}

async function complete(
  system: string,
  turns: CompleteTurn[],
  provider: LlmProvider = llm,
  onProviderUsage?: (provider: string, usage: TokenUsage) => void,
): Promise<{ text: string; usage: TokenUsage }> {
  try {
    const result = await provider.complete({ system, turns, maxTokens: config.SYNTH_MAX_OUTPUT_TOKENS });
    // Reported the moment a real response comes back, not once the whole
    // multi-step call finishes — so tokens spent on an attempt that a later
    // step then fails are still counted, not silently dropped with the throw.
    onProviderUsage?.(provider.id, result.usage);
    return result;
  } catch (err) {
    // The same-provider, lighter-model fallback only makes sense while still
    // on the primary — once withTimeoutRetry has already switched to
    // llmSecondary, there is no second fallback behind that.
    if (provider === llm && llmFallback && llm.isRateLimited(err)) {
      try {
        const result = await llmFallback.complete({ system, turns, maxTokens: config.SYNTH_MAX_OUTPUT_TOKENS });
        onProviderUsage?.(llmFallback.id, result.usage);
        return result;
      } catch (fallbackErr) {
        throw new Error(
          `${llm.describeError(err)} (fallback model ${llmFallback.model} also failed: ${llmFallback.describeError(fallbackErr)})`,
        );
      }
    }
    throw new Error(provider.describeError(err));
  }
}

function extractCode(text: string): string {
  const fenced = /```(?:javascript|js|ts|typescript)?\s*\n([\s\S]*?)```/m.exec(text);
  const code = (fenced?.[1] ?? text).trim();
  if (!code) throw new Error("The model returned no spec code.");
  return code;
}

/**
 * Defence in depth, not a sandbox.
 *
 * The verify phase executes model-written JavaScript on this host. The real
 * mitigation is running the runner in a container (see README); this catches
 * the obvious cases - shelling out, touching the filesystem, reading secrets -
 * so a bad generation fails loudly instead of quietly doing something else.
 */
const FORBIDDEN: Array<{ pattern: RegExp; what: string }> = [
  { pattern: /\bchild_process\b|\bexecSync\b|\bspawnSync\b/, what: "spawning a process" },
  { pattern: /\brequire\s*\(\s*['"]fs['"]|\bfrom\s+['"]node:fs['"]/, what: "filesystem access" },
  { pattern: /\bprocess\.env\b/, what: "reading environment variables" },
  { pattern: /\beval\s*\(|new\s+Function\s*\(/, what: "dynamic code evaluation" },
  { pattern: /\bprocess\.(exit|kill)\b/, what: "killing the process" },
];

function guardSpec(code: string): string {
  for (const { pattern, what } of FORBIDDEN) {
    if (pattern.test(code)) {
      throw new Error(
        `Generated spec was rejected before execution: it attempts ${what}, which a UI test has no reason to do.`,
      );
    }
  }
  return code;
}
