import { randomUUID } from "node:crypto";
import type { Tool as McpTool } from "@modelcontextprotocol/sdk/types.js";
import { config } from "../config.js";
import { llm, type LlmToolDef, type LlmToolResult } from "./llm/index.js";
import { addUsage, emptyUsage, type TokenUsage } from "./llm/types.js";
import { EXPLORER_SYSTEM, explorerTask } from "./prompts.js";
import { coerceToolInput, convertToolResult } from "../mcp/bridge.js";
import type { WdioMcp } from "../mcp/client.js";
import type { LanePlan } from "../lanes/capabilities.js";
import type { SecretBag } from "../lanes/secrets.js";
import type { AgentStep, Platform, Screenshot } from "../types.js";

export interface ExploreEmitter {
  text(text: string): void;
  toolStarted(step: AgentStep): void;
  toolFinished(id: string, ok: boolean, summary: string): void;
  screenshot(shot: Screenshot): void;
}

export interface ExploreResult {
  /** Ordered, human-readable record of what happened - feeds synthesis. */
  transcript: string;
  /** The agent's closing summary. */
  finalText: string;
  /** True when the agent stopped without the model reporting it was done. */
  exhausted: boolean;
  /** Why `exhausted` is true — shapes the message a human sees on the run. */
  exhaustedReason?: "budget" | "unresponsive";
  usage: TokenUsage;
}

export interface ExploreArgs {
  mcp: WdioMcp;
  tools: LlmToolDef[];
  /** Original MCP schemas, pre-widening - used to coerce a stringified boolean back before the tool sees it. */
  mcpTools: McpTool[];
  prompt: string;
  platform: Platform;
  plan: LanePlan;
  budget: number;
  emit: ExploreEmitter;
  signal: AbortSignal;
  secrets: SecretBag;
  /** Static pre-fetch of the target page, if one was taken. Web lane only. */
  siteSkim?: string | null;
}

/**
 * Drive the device until the scenario is done or the budget runs out.
 *
 * A hand-rolled loop rather than an SDK helper: this needs per-tool-call events
 * pushed to the UI as they happen, a hard step budget that can cut the
 * conversation mid-flight (device minutes are metered), MCP tool schemas
 * discovered at runtime, and the same shape across two different provider APIs.
 */
/**
 * Consecutive tool-call failures before the loop gives up on the device
 * rather than the budget.
 *
 * A page that is merely slow recovers within a call or two; a session that is
 * genuinely stuck (a hung redirect, a blocking native dialog, a lost
 * connection) does not recover on its own, and every retry after the first
 * one or two is spending budget to learn the same thing again. Observed in
 * practice: 6 straight timeouts — read tree, screenshot, read tree,
 * screenshot, navigate, screenshot — burned the rest of a run's budget
 * without ever producing another usable observation.
 */
const STUCK_AFTER_FAILURES = 3;

export async function explore(args: ExploreArgs): Promise<ExploreResult> {
  const { mcp, tools, mcpTools, prompt, platform, plan, budget, emit, signal, secrets, siteSkim } = args;
  const toolByName = new Map(mcpTools.map((t) => [t.name, t]));

  const conversation = llm.startConversation({
    system: EXPLORER_SYSTEM,
    tools,
    maxTokens: config.EXPLORE_MAX_OUTPUT_TOKENS,
    sendImages: config.llm.sendScreenshots,
    requestBudgetTokens: config.llm.requestBudgetTokens,
  });

  const transcript: string[] = [];
  let next: string | LlmToolResult[] = explorerTask(prompt, platform, plan, secrets, siteSkim);
  let toolCalls = 0;
  let usage = emptyUsage();
  let consecutiveFailures = 0;

  for (;;) {
    signal.throwIfAborted();

    if (toolCalls >= budget) {
      // Let the model close out cleanly instead of truncating the transcript.
      const closing = await send(
        conversation,
        `Tool budget exhausted (${budget} calls). Stop exploring now and write your final summary: did the scenario succeed, what steps did you perform, and what assertions prove the outcome?`,
      );
      usage = addUsage(usage, closing.usage);
      if (closing.text) emit.text(closing.text);
      transcript.push(`\n[budget exhausted after ${budget} tool calls]`);
      if (closing.text) transcript.push(`\nAgent summary:\n${closing.text}`);
      return {
        transcript: transcript.join("\n"),
        finalText: closing.text,
        exhausted: true,
        exhaustedReason: "budget",
        usage,
      };
    }

    const turn = await send(conversation, next);
    usage = addUsage(usage, turn.usage);

    if (turn.stopReason === "refusal") {
      throw new Error(`The model declined to continue: ${turn.refusalReason ?? "no explanation given"}`);
    }

    if (turn.text) {
      emit.text(turn.text);
      transcript.push(`Agent: ${turn.text}`);
    }

    if (turn.toolCalls.length === 0) {
      if (turn.stopReason === "max_tokens") {
        transcript.push("\n[response truncated at max_tokens]");
      }
      transcript.push(`\nAgent summary:\n${turn.text}`);
      return { transcript: transcript.join("\n"), finalText: turn.text, exhausted: false, usage };
    }

    const results: LlmToolResult[] = [];
    for (const call of turn.toolCalls) {
      signal.throwIfAborted();
      toolCalls += 1;

      const mcpTool = toolByName.get(call.name);
      const input = mcpTool ? coerceToolInput(mcpTool, call.input) : call.input;

      const step: AgentStep = { id: call.id, name: call.name, input, at: Date.now() };
      emit.toolStarted(step);

      // Substitution happens after schema coercion and nowhere earlier: `input`
      // keeps the placeholder the model wrote, so the recorded step and the
      // transcript below show `{{PASSWORD}}` rather than the password.
      const raw = await mcp.callTool(call.name, secrets.fill(input));
      const converted = redactResult(convertToolResult(raw, config.llm.maxToolResultChars), secrets);

      // Screenshots always reach the UI; whether they also reach the model is a
      // cost decision made in config.
      for (const dataUrl of converted.images) {
        emit.screenshot({ id: randomUUID(), dataUrl, at: Date.now(), caption: call.name });
      }

      emit.toolFinished(call.id, !raw.isError, converted.summary);
      transcript.push(
        `${raw.isError ? "x" : "+"} ${call.name}(${compactJson(input)}) -> ${converted.summary}`,
      );

      consecutiveFailures = raw.isError ? consecutiveFailures + 1 : 0;

      results.push({
        id: call.id,
        name: call.name,
        text: converted.text,
        images: converted.images,
        isError: raw.isError,
      });
    }

    if (consecutiveFailures >= STUCK_AFTER_FAILURES) {
      const closing = await send(
        conversation,
        `The last ${consecutiveFailures} device commands in a row failed or timed out. This looks like the session is stuck — a hung redirect, a blocking dialog, or a lost connection — not merely a slow page, since retrying different kinds of commands has not recovered it. Stop exploring now and write your final summary: what you completed before the device stopped responding.`,
      );
      usage = addUsage(usage, closing.usage);
      if (closing.text) emit.text(closing.text);
      transcript.push(`\n[device stopped responding after ${consecutiveFailures} consecutive failed commands]`);
      if (closing.text) transcript.push(`\nAgent summary:\n${closing.text}`);
      return {
        transcript: transcript.join("\n"),
        finalText: closing.text,
        exhausted: true,
        exhaustedReason: "unresponsive",
        usage,
      };
    }

    next = results;
  }
}

async function send(conversation: ReturnType<typeof llm.startConversation>, input: string | LlmToolResult[]) {
  try {
    return await conversation.send(input);
  } catch (err) {
    throw new Error(llm.describeError(err));
  }
}

/**
 * Scrub credentials out of whatever the device sent back.
 *
 * A `get_elements` call after typing into a login form routinely returns the
 * field's current value, and that text is about to be sent to the model, pushed
 * to the browser, and folded into the transcript that synthesis reads. Redacting
 * at the single point where device output enters the system covers all three.
 */
function redactResult(converted: ReturnType<typeof convertToolResult>, secrets: SecretBag) {
  if (secrets.isEmpty) return converted;
  return {
    ...converted,
    text: secrets.redact(converted.text),
    summary: secrets.redact(converted.summary),
  };
}

function compactJson(value: unknown): string {
  const json = JSON.stringify(value ?? {});
  return json.length > 200 ? `${json.slice(0, 197)}...` : json;
}
