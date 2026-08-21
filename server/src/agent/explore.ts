import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import { llm, type LlmToolDef, type LlmToolResult } from "./llm/index.js";
import { EXPLORER_SYSTEM, explorerTask } from "./prompts.js";
import { convertToolResult } from "../mcp/bridge.js";
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
  /** True when the agent ran out of budget rather than finishing. */
  exhausted: boolean;
}

export interface ExploreArgs {
  mcp: WdioMcp;
  tools: LlmToolDef[];
  prompt: string;
  platform: Platform;
  plan: LanePlan;
  budget: number;
  emit: ExploreEmitter;
  signal: AbortSignal;
  secrets: SecretBag;
}

/**
 * Drive the device until the scenario is done or the budget runs out.
 *
 * A hand-rolled loop rather than an SDK helper: this needs per-tool-call events
 * pushed to the UI as they happen, a hard step budget that can cut the
 * conversation mid-flight (device minutes are metered), MCP tool schemas
 * discovered at runtime, and the same shape across two different provider APIs.
 */
export async function explore(args: ExploreArgs): Promise<ExploreResult> {
  const { mcp, tools, prompt, platform, plan, budget, emit, signal, secrets } = args;

  const conversation = llm.startConversation({
    system: EXPLORER_SYSTEM,
    tools,
    maxTokens: config.EXPLORE_MAX_OUTPUT_TOKENS,
    sendImages: config.llm.sendScreenshots,
  });

  const transcript: string[] = [];
  let next: string | LlmToolResult[] = explorerTask(prompt, platform, plan, secrets);
  let toolCalls = 0;

  for (;;) {
    signal.throwIfAborted();

    if (toolCalls >= budget) {
      // Let the model close out cleanly instead of truncating the transcript.
      const closing = await send(
        conversation,
        `Tool budget exhausted (${budget} calls). Stop exploring now and write your final summary: did the scenario succeed, what steps did you perform, and what assertions prove the outcome?`,
      );
      if (closing.text) emit.text(closing.text);
      transcript.push(`\n[budget exhausted after ${budget} tool calls]`);
      if (closing.text) transcript.push(`\nAgent summary:\n${closing.text}`);
      return { transcript: transcript.join("\n"), finalText: closing.text, exhausted: true };
    }

    const turn = await send(conversation, next);

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
      return { transcript: transcript.join("\n"), finalText: turn.text, exhausted: false };
    }

    const results: LlmToolResult[] = [];
    for (const call of turn.toolCalls) {
      signal.throwIfAborted();
      toolCalls += 1;

      const step: AgentStep = { id: call.id, name: call.name, input: call.input, at: Date.now() };
      emit.toolStarted(step);

      // Placeholders become real values here and nowhere earlier: `call.input`
      // stays as the model wrote it, so the transcript and the UI step list
      // record `{{PASSWORD}}` rather than the password.
      const raw = await mcp.callTool(call.name, secrets.fill(call.input));
      const converted = redactResult(convertToolResult(raw), secrets);

      // Screenshots always reach the UI; whether they also reach the model is a
      // cost decision made in config.
      for (const dataUrl of converted.images) {
        emit.screenshot({ id: randomUUID(), dataUrl, at: Date.now(), caption: call.name });
      }

      emit.toolFinished(call.id, !raw.isError, converted.summary);
      transcript.push(
        `${raw.isError ? "x" : "+"} ${call.name}(${compactJson(call.input)}) -> ${converted.summary}`,
      );

      results.push({
        id: call.id,
        name: call.name,
        text: converted.text,
        images: converted.images,
        isError: raw.isError,
      });
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
