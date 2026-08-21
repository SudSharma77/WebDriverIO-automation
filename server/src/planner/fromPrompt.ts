import { llm } from "../agent/llm/index.js";
import { config } from "../config.js";
import { renderIndex } from "../framework/render.js";
import type { FrameworkIndex } from "../framework/types.js";
import { PLANNER_SYSTEM, plannerTask, repairTask } from "./prompts.js";
import { resolvePlan } from "./resolve.js";
import type { RequestStep, TestPlan, TestRequest } from "./types.js";

export interface MissingCapability {
  capability: string;
  suggestedClass?: string;
  suggestedMethod?: string;
}

export interface PromptPlanResult {
  plan: TestPlan;
  /** Steps the model could not express with what exists — the "create" list. */
  missing: MissingCapability[];
  /** Title of an existing spec that already covers this, if any. */
  duplicateOf?: string;
  /** How many model round-trips were spent. 0 means none were needed. */
  llmCalls: number;
}

/**
 * Turn a plain-English test case into a validated plan.
 *
 * The model only ever *proposes*. Every capability it names is checked against
 * the real index by `resolvePlan`, so a hallucinated method cannot reach the
 * generated spec — it comes back as a problem, and one repair round is spent
 * letting the model either pick a real method or admit the gap. What survives
 * is guaranteed callable.
 */
export async function planFromPrompt(
  index: FrameworkIndex,
  prompt: string,
  platform: "web" | "mobile" = "web",
): Promise<PromptPlanResult> {
  const inventory = renderIndex(index, { platform, budgetTokens: config.PLANNER_INDEX_BUDGET });

  let raw = await ask([{ role: "user", text: plannerTask(inventory, prompt, platform) }]);
  let proposal = parseProposal(raw);
  let plan = resolvePlan(index, toRequest(proposal, platform));
  let llmCalls = 1;

  // One repair round. Beyond that the gap is real, not a naming slip, and the
  // honest answer is to report it rather than keep paying for retries.
  if (plan.problems.length > 0) {
    const retry = await ask([
      { role: "user", text: plannerTask(inventory, prompt, platform) },
      { role: "assistant", text: raw },
      { role: "user", text: repairTask(plan.problems) },
    ]);
    llmCalls = 2;
    const revised = parseProposal(retry);
    const revisedPlan = resolvePlan(index, toRequest(revised, platform));
    // Keep the revision only if it is genuinely better.
    if (revisedPlan.problems.length < plan.problems.length) {
      raw = retry;
      proposal = revised;
      plan = revisedPlan;
    }
  }

  return {
    plan,
    missing: proposal.missing ?? [],
    duplicateOf: proposal.duplicateOf ?? undefined,
    llmCalls,
  };
}

async function ask(turns: Array<{ role: "user" | "assistant"; text: string }>): Promise<string> {
  try {
    const { text } = await llm.complete({
      system: PLANNER_SYSTEM,
      turns,
      maxTokens: config.PLANNER_MAX_OUTPUT_TOKENS,
      json: true,
    });
    return text;
  } catch (err) {
    throw new Error(llm.describeError(err));
  }
}

interface Proposal {
  title?: string;
  test?: string;
  platform?: string;
  data?: { file?: string; index?: number; as?: string };
  steps?: unknown[];
  missing?: MissingCapability[];
  duplicateOf?: string | null;
}

/** Models wrap JSON in prose or fences often enough to be worth handling. */
function parseProposal(raw: string): Proposal {
  const fenced = /```(?:json)?\s*\n([\s\S]*?)```/m.exec(raw);
  const candidate = (fenced?.[1] ?? raw).trim();

  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  const json = start >= 0 && end > start ? candidate.slice(start, end + 1) : candidate;

  try {
    return JSON.parse(json) as Proposal;
  } catch {
    throw new Error("The planner did not return valid JSON. Try a more specific test case, or a stronger model.");
  }
}

function toRequest(proposal: Proposal, platform: "web" | "mobile"): TestRequest {
  const steps = Array.isArray(proposal.steps) ? proposal.steps.filter(isStep) : [];
  const request: TestRequest = {
    title: proposal.title?.trim() || "Generated test",
    test: proposal.test?.trim() || "performs the requested scenario",
    platform: proposal.platform === "mobile" ? "mobile" : platform,
    steps,
  };
  if (proposal.data?.file) {
    request.data = {
      file: proposal.data.file,
      index: typeof proposal.data.index === "number" ? proposal.data.index : 0,
      as: proposal.data.as || "data",
    };
  }
  return request;
}

function isStep(value: unknown): value is RequestStep {
  if (!value || typeof value !== "object") return false;
  const step = value as Record<string, unknown>;
  if (typeof step.use === "string") return true;
  return typeof step.expect === "string" && typeof step.matcher === "string";
}
