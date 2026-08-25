import Anthropic from "@anthropic-ai/sdk";
import type {
  CompleteTurn,
  LlmConversation,
  LlmProvider,
  LlmToolDef,
  LlmToolResult,
  LlmTurn,
  StopReason,
  TokenUsage,
} from "./types.js";
import { estimateTokens, trimHistory } from "./budget.js";

export interface AnthropicProviderOptions {
  apiKey: string;
  model: string;
  maxRetries: number;
}

export function createAnthropicProvider(opts: AnthropicProviderOptions): LlmProvider {
  const client = new Anthropic({ apiKey: opts.apiKey, maxRetries: opts.maxRetries });

  const provider: LlmProvider = {
    id: "anthropic",
    model: opts.model,
    supportsVision: true,

    startConversation({ system, tools, maxTokens, sendImages, requestBudgetTokens = 0 }) {
      const messages: Anthropic.MessageParam[] = [];
      const toolDefs = tools.map(toAnthropicTool);
      // System lives outside `messages` here, so it counts as overhead rather
      // than as trimmable history.
      const overhead = estimateTokens(system) + estimateTokens(toolDefs) + maxTokens;

      const conversation: LlmConversation = {
        async send(input) {
          messages.push(
            typeof input === "string"
              ? { role: "user", content: input }
              : { role: "user", content: input.map((r) => toToolResult(r, sendImages)) },
          );

          // Only the opening task is pinned. Dropping whole assistant→user
          // pairs preserves both the strict user/assistant alternation the API
          // requires and every tool_use ↔ tool_result pairing.
          trimHistory(messages, {
            overhead,
            budget: requestBudgetTokens,
            pinned: 1,
            startsGroup: (m) => m.role === "assistant",
          });

          const response = await client.messages.create({
            model: opts.model,
            max_tokens: maxTokens,
            // Frozen prefix, cached across every lane of every run.
            system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
            tools: toolDefs,
            messages,
          });

          // Echoed back whole: thinking blocks must survive the round trip.
          messages.push({ role: "assistant", content: response.content });

          return toTurn(response);
        },
      };

      return conversation;
    },

    async complete({ system, turns, maxTokens, json }) {
      const messages: Anthropic.MessageParam[] = turns.map((t) => ({ role: t.role, content: t.text }));

      // Anthropic has no JSON mode; prefilling an opening brace is the
      // documented equivalent and removes any prose preamble.
      if (json && messages.at(-1)?.role === "user") {
        messages.push({ role: "assistant", content: "{" });
      }

      const response = await client.messages.create({
        model: opts.model,
        max_tokens: maxTokens,
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        messages,
      });

      const text = textOf(response);
      // Some models drop the opening brace when told to emit JSON; restoring it
      // is cheaper and more reliable than a reprompt.
      const repaired = json && !text.trimStart().startsWith("{") ? `{${text}` : text;
      return { text: repaired, usage: usageOf(response) };
    },

    describeError(err) {
      if (err instanceof Anthropic.AuthenticationError) {
        return "Anthropic rejected the API key. Check ANTHROPIC_API_KEY in .env.";
      }
      if (err instanceof Anthropic.RateLimitError) {
        return "Rate limited by the Anthropic API. Retry shortly, or lower MAX_AGENT_STEPS.";
      }
      if (err instanceof Anthropic.NotFoundError) {
        return `Model "${opts.model}" was not found. Check LLM_MODEL.`;
      }
      if (err instanceof Anthropic.APIError) {
        return `Anthropic API error ${err.status}: ${err.message}`;
      }
      return err instanceof Error ? err.message : String(err);
    },

    isRateLimited(err) {
      return err instanceof Anthropic.RateLimitError;
    },
  };

  return provider;
}

function toAnthropicTool(tool: LlmToolDef): Anthropic.Tool {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.schema as Anthropic.Tool.InputSchema,
  };
}

function toToolResult(result: LlmToolResult, sendImages: boolean): Anthropic.ToolResultBlockParam {
  const blocks: Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam> = [];

  if (sendImages) {
    for (const dataUrl of result.images) {
      const parsed = parseDataUrl(dataUrl);
      if (parsed) {
        blocks.push({
          type: "image",
          source: { type: "base64", media_type: parsed.mediaType, data: parsed.data },
        });
      }
    }
  }

  const text = result.text || (result.isError ? "Tool reported an error." : "OK");
  blocks.push({ type: "text", text });

  return { type: "tool_result", tool_use_id: result.id, content: blocks, is_error: result.isError };
}

function toTurn(response: Anthropic.Message): LlmTurn {
  const toolCalls = response.content
    .filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
    .map((b) => ({ id: b.id, name: b.name, input: (b.input ?? {}) as Record<string, unknown> }));

  return {
    text: textOf(response),
    toolCalls,
    stopReason: mapStop(response.stop_reason, toolCalls.length > 0),
    refusalReason: response.stop_details?.explanation ?? undefined,
    usage: usageOf(response),
  };
}

function mapStop(reason: Anthropic.Message["stop_reason"], hasTools: boolean): StopReason {
  switch (reason) {
    case "tool_use":
      return "tool_use";
    case "end_turn":
    case "stop_sequence":
      return hasTools ? "tool_use" : "end";
    case "max_tokens":
      return "max_tokens";
    case "refusal":
      return "refusal";
    default:
      return hasTools ? "tool_use" : "other";
  }
}

function textOf(response: Anthropic.Message): string {
  return response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

/** Cache read/write tokens count toward input for display purposes - they're still input tokens, just cheaper ones. */
function usageOf(response: Anthropic.Message): TokenUsage {
  const usage = response.usage;
  return {
    inputTokens: usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0),
    outputTokens: usage.output_tokens,
  };
}

type MediaType = "image/png" | "image/jpeg" | "image/webp" | "image/gif";

function parseDataUrl(url: string): { mediaType: MediaType; data: string } | null {
  const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,(.+)$/.exec(url);
  if (!match?.[1] || !match[2]) return null;
  return { mediaType: match[1] as MediaType, data: match[2] };
}
