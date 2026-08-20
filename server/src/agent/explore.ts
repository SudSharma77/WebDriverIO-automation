import { randomUUID } from "node:crypto";
import type { Tool as McpTool } from "@modelcontextprotocol/sdk/types.js";
import { config } from "../config.js";
import { llm, type LlmToolDef, type LlmToolResult } from "./llm/index.js";
import { addUsage, emptyUsage, type TokenUsage } from "./llm/types.js";
import { EXPLORER_SYSTEM, explorerTask } from "./prompts.js";
import { coerceToolInput, convertToolResult } from "../mcp/bridge.js";
import type { WdioMcp } from "../mcp/client.js";
import type { LanePlan } from "../lanes/capabilities.js";
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
export async function explore(args: ExploreArgs): Promise<ExploreResult> {
  const { mcp, tools, mcpTools, prompt, platform, plan, budget, emit, signal, siteSkim } = args;
  const toolByName = new Map(mcpTools.map((t) => [t.name, t]));

  const conversation = llm.startConversation({
    system: EXPLORER_SYSTEM,
    tools,
    maxTokens: config.EXPLORE_MAX_OUTPUT_TOKENS,
    sendImages: config.llm.sendScreenshots,
  });

  const transcript: string[] = [];
  let next: string | LlmToolResult[] = explorerTask(prompt, platform, plan, siteSkim);
  let toolCalls = 0;
  let usage = emptyUsage();

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
      return { transcript: transcript.join("\n"), finalText: closing.text, exhausted: true, usage };
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

      const raw = await mcp.callTool(call.name, input);
      const converted = convertToolResult(raw);

      // Screenshots always reach the UI; whether they also reach the model is a
      // cost decision made in config.
      for (const dataUrl of converted.images) {
        emit.screenshot({ id: randomUUID(), dataUrl, at: Date.now(), caption: call.name });
      }

      emit.toolFinished(call.id, !raw.isError, converted.summary);
      transcript.push(
        `${raw.isError ? "x" : "+"} ${call.name}(${compactJson(input)}) -> ${converted.summary}`,
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

function compactJson(value: unknown): string {
  const json = JSON.stringify(value ?? {});
  return json.length > 200 ? `${json.slice(0, 197)}...` : json;
}
