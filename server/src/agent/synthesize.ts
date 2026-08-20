import { config } from "../config.js";
import { lintSpec } from "./lint.js";
import { llm, llmFallback } from "./llm/index.js";
import type { CompleteTurn } from "./llm/types.js";
import { FAILURE_SUMMARY_SYSTEM, SCAFFOLD_SYSTEM, SYNTH_SYSTEM, failureSummaryTask, scaffoldTask, synthTask } from "./prompts.js";
import type { LanePlan } from "../lanes/capabilities.js";
import type { Platform } from "../types.js";

export interface SynthArgs {
  prompt: string;
  platform: Platform;
  plan: LanePlan;
  transcript: string;
  recorded: string | null;
}

/**
 * Two-phase generation: structure the scenario into a fixed plan first, then
 * implement that plan as code. This is what makes a one-line prompt and a
 * paragraph-long one produce equally structured specs — the plan step is the
 * same fixed template either way, rather than the code model free-associating
 * structure straight out of a possibly-terse transcript.
 */
export async function synthesizeSpec(args: SynthArgs): Promise<string> {
  const scaffold = await generateScaffold(args);
  const text = await complete(SYNTH_SYSTEM, [{ role: "user", text: synthTask({ ...args, scaffold }) }]);
  let code = guardSpec(extractCode(text));

  // Deterministic quality gate: a prose rule in SYNTH_SYSTEM can be ignored: a
  // lint rule can't be. eslint-plugin-wdio's rules aren't auto-fixable, so a
  // real hit (most commonly a missing `await` before `expect(...)`, which
  // silently never actually asserts anything) gets one targeted repair call.
  const lint = await lintSpec(code);
  if (lint.issues.length > 0) {
    code = await fixLintIssues({ ...args, spec: code, scaffold, issues: lint.issues });
  }

  return withScaffoldHeader(code, scaffold);
}

async function fixLintIssues(
  args: SynthArgs & { spec: string; scaffold: string; issues: string[] },
): Promise<string> {
  const text = await complete(SYNTH_SYSTEM, [
    { role: "user", text: synthTask(args) },
    { role: "assistant", text: "```javascript\n" + args.spec + "\n```" },
    {
      role: "user",
      text: [
        "A deterministic lint pass (eslint-plugin-wdio) found real issues in that file:",
        "",
        args.issues.map((i) => `- ${i}`).join("\n"),
        "",
        "Fix ONLY these issues — do not change the plan, the selectors, or the assertions otherwise. Emit the corrected full file in one ```javascript block, nothing else.",
      ].join("\n"),
    },
  ]);
  return guardSpec(extractCode(text));
}

async function generateScaffold(args: SynthArgs): Promise<string> {
  const text = await complete(SCAFFOLD_SYSTEM, [{ role: "user", text: scaffoldTask(args) }]);
  const scaffold = text.trim();
  if (!scaffold) throw new Error("The model returned no structured plan.");
  return scaffold;
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
): Promise<string> {
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
      "DOM snapshot captured at the moment of failure (truncated). Check whether the selector the failing step used was present, hidden, disabled, or simply not there yet:",
      "```html",
      args.domSnapshot.slice(0, 4000),
      "```",
    );
  }

  parts.push(
    "",
    "Fix the spec so it passes on a cold session. Common causes: an element that needs waitForDisplayed before interaction, a step that assumed state left behind by the exploratory session, or a selector that was observed after a scroll that the spec never performs. Use the DOM snapshot above (if present) to confirm which of these actually happened rather than guessing.",
    "Keep the same plan, the same scenario, and the same assertions — fix the implementation, not the structure. Emit the corrected full file (including its structured-plan comment header, unchanged) in one ```javascript block, nothing else.",
  );

  // The plan already lives in the header this file was generated with (see
  // withScaffoldHeader) - reuse it rather than re-running the structure phase,
  // which could quietly change the plan mid-repair.
  const scaffold = extractScaffoldHeader(args.spec) ?? (await generateScaffold(args));

  const text = await complete(SYNTH_SYSTEM, [
    { role: "user", text: synthTask({ ...args, scaffold }) },
    { role: "assistant", text: "```javascript\n" + args.spec + "\n```" },
    { role: "user", text: parts.join("\n") },
  ]);
  return guardSpec(extractCode(text));
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
}): Promise<string | null> {
  try {
    const text = await complete(FAILURE_SUMMARY_SYSTEM, [{ role: "user", text: failureSummaryTask(args) }]);
    return text.trim() || null;
  } catch {
    return null;
  }
}

async function complete(system: string, turns: CompleteTurn[]): Promise<string> {
  try {
    return await llm.complete({ system, turns, maxTokens: config.SYNTH_MAX_OUTPUT_TOKENS });
  } catch (err) {
    if (llmFallback && llm.isRateLimited(err)) {
      try {
        return await llmFallback.complete({ system, turns, maxTokens: config.SYNTH_MAX_OUTPUT_TOKENS });
      } catch (fallbackErr) {
        throw new Error(
          `${llm.describeError(err)} (fallback model ${llmFallback.model} also failed: ${llmFallback.describeError(fallbackErr)})`,
        );
      }
    }
    throw new Error(llm.describeError(err));
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
