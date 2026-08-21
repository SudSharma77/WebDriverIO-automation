import { config } from "../config.js";
import { bindSecretsInSpec, unbindSecretsInSpec } from "../lanes/secrets.js";
import { llm } from "./llm/index.js";
import type { CompleteTurn } from "./llm/types.js";
import { SYNTH_SYSTEM, synthTask } from "./prompts.js";
import type { LanePlan } from "../lanes/capabilities.js";
import type { Platform } from "../types.js";

export interface SynthArgs {
  prompt: string;
  platform: Platform;
  plan: LanePlan;
  transcript: string;
  recorded: string | null;
}

export async function synthesizeSpec(args: SynthArgs): Promise<string> {
  const text = await complete([{ role: "user", text: synthTask(args) }]);
  return finish(text);
}

/**
 * Guard first, then bind.
 *
 * Running the guard on the model's own output keeps `process.env` completely
 * forbidden to it, so the only environment reads that can appear in the finished
 * spec are the credential placeholders we rewrote ourselves.
 */
function finish(text: string): string {
  return bindSecretsInSpec(guardSpec(extractCode(text)));
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
export async function repairSpec(args: SynthArgs & { spec: string; failure: string }): Promise<string> {
  const text = await complete([
    { role: "user", text: synthTask(args) },
    { role: "assistant", text: "```javascript\n" + unbindSecretsInSpec(args.spec) + "\n```" },
    {
      role: "user",
      text: [
        "That spec failed when replayed by the WebdriverIO runner. Output from the run:",
        "",
        "```",
        args.failure.slice(-6000),
        "```",
        "",
        "Fix the spec so it passes on a cold session. Common causes: an element that needs waitForDisplayed before interaction, a step that assumed state left behind by the exploratory session, or a selector that was observed after a scroll that the spec never performs.",
        "Keep the same scenario and the same assertions. Emit the corrected full file in one ```javascript block, nothing else.",
      ].join("\n"),
    },
  ]);
  return finish(text);
}

async function complete(turns: CompleteTurn[]): Promise<string> {
  try {
    return await llm.complete({ system: SYNTH_SYSTEM, turns, maxTokens: config.SYNTH_MAX_OUTPUT_TOKENS });
  } catch (err) {
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
