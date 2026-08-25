import OpenAI from "openai";
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
import { emptyUsage } from "./types.js";
import { estimateTokens, trimHistory } from "./budget.js";

export interface OpenAiCompatibleOptions {
  /** "groq", "openai", "ollama", … — surfaced in logs and errors. */
  id: string;
  apiKey: string;
  baseURL: string;
  model: string;
  supportsVision: boolean;
  maxRetries: number;
  /**
   * Which field caps the response. OpenAI deprecated `max_tokens` in favour of
   * `max_completion_tokens` and its reasoning models reject the old name, but
   * some compatibility layers (Google's among them) only document the old one.
   * Sending the wrong one is either a 400 or, worse, a silently ignored cap.
   */
  tokenParam?: "max_tokens" | "max_completion_tokens";
}

/**
 * Adapter for any OpenAI-compatible chat-completions endpoint: Groq, OpenAI,
 * Together, a local Ollama, etc.
 *
 * Two things differ structurally from the Anthropic API and are handled here
 * rather than leaking to the call site:
 *
 *  1. `role: "tool"` messages carry text only. Screenshots therefore cannot
 *     ride along with a tool result the way they do on Anthropic — they are
 *     emitted as a follow-up user message instead.
 *  2. There is no explicit prompt-cache control. The system prompt and tool
 *     list are still kept byte-stable so providers that cache automatically
 *     can do so.
 */
export function createOpenAiCompatibleProvider(opts: OpenAiCompatibleOptions): LlmProvider {
  const client = new OpenAI({
    apiKey: opts.apiKey,
    baseURL: opts.baseURL,
    // Free tiers 429 constantly; the SDK honours Retry-After on each attempt.
    maxRetries: opts.maxRetries,
  });

  /** The response cap, under whichever field name this endpoint accepts. */
  const cap = (n: number) =>
    opts.tokenParam === "max_tokens" ? { max_tokens: n } : { max_completion_tokens: n };

  const provider: LlmProvider = {
    id: opts.id,
    model: opts.model,
    supportsVision: opts.supportsVision,

    startConversation({ system, tools, maxTokens, sendImages, requestBudgetTokens = 0 }) {
      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [{ role: "system", content: system }];
      const toolDefs = tools.map(toOpenAiTool);
      const withImages = sendImages && opts.supportsVision;
      // Fixed cost re-billed on every turn: the schemas plus whatever output we
      // reserve. Only history can be shed, so it is measured against this.
      const overhead = estimateTokens(toolDefs) + maxTokens;

      const conversation: LlmConversation = {
        async send(input) {
          if (typeof input === "string") {
            messages.push({ role: "user", content: input });
          } else {
            for (const result of input) {
              messages.push({
                role: "tool",
                tool_call_id: result.id,
                content: result.text || (result.isError ? "Tool reported an error." : "OK"),
              });
            }

            // Images cannot attach to a tool message, so they follow as a user
            // turn. Without this the model is blind to every screenshot.
            const images = withImages ? input.flatMap((r) => r.images) : [];
            if (images.length > 0) {
              messages.push({
                role: "user",
                content: [
                  { type: "text", text: "Current screen:" },
                  ...images.map((url) => ({ type: "image_url" as const, image_url: { url } })),
                ],
              });
            }
          }

          // Index 0 is the system prompt and index 1 the opening task; both are
          // pinned. Groups begin at each assistant message, so an assistant
          // turn and the `role: "tool"` messages answering it always leave
          // together — the API rejects a tool message whose call is gone.
          trimHistory(messages, {
            overhead,
            budget: requestBudgetTokens,
            pinned: 2,
            startsGroup: (m) => m.role === "assistant",
          });

          const response = await client.chat.completions.create({
            model: opts.model,
            ...cap(maxTokens),
            messages,
            tools: toolDefs,
          });

          const choice = response.choices[0];
          if (!choice) throw new Error(`${opts.id} returned no completion choices.`);

          // Echoed back verbatim: the API requires every tool_call it emitted
          // to be answered by a matching tool message next turn.
          messages.push(choice.message);

          return toTurn(choice, usageOf(response));
        },
      };

      return conversation;
    },

    async complete({ system, turns, maxTokens, json }) {
      const response = await client.chat.completions.create({
        model: opts.model,
        ...cap(maxTokens),
        ...(json ? { response_format: { type: "json_object" as const } } : {}),
        messages: [
          { role: "system", content: system },
          ...turns.map((t) => ({ role: t.role, content: t.text }) as OpenAI.Chat.ChatCompletionMessageParam),
        ],
      });
      return { text: response.choices[0]?.message.content?.trim() ?? "", usage: usageOf(response) };
    },

    describeError(err) {
      if (err instanceof OpenAI.AuthenticationError) {
        return `${opts.id} rejected the API key. Check LLM_API_KEY in .env.`;
      }
      if (err instanceof OpenAI.RateLimitError) {
        return `Rate limited by ${opts.id}. Free tiers cap tokens per minute and per day — lower MAX_AGENT_STEPS, set SEND_SCREENSHOTS_TO_MODEL=false, or run one platform at a time.`;
      }
      if (err instanceof OpenAI.NotFoundError) {
        return `Model "${opts.model}" is not available on ${opts.id}. Check LLM_MODEL — GET ${opts.baseURL}/models lists what your key can use.`;
      }
      // Providers bill tokens-per-minute against prompt + reserved output, so a
      // request can be "too large" while the prompt itself is small. Say which
      // knob fixes it rather than echoing a raw 413.
      if (err instanceof OpenAI.APIError && err.status === 413) {
        return `${opts.id} rejected the request as too large for its per-minute token limit. Set LLM_TPM_LIMIT in .env to the limit the message below quotes — history is then trimmed to fit automatically. If it persists, lower MAX_TOOL_RESULT_CHARS (a single page read can be thousands of tokens) or EXPLORE_MAX_OUTPUT_TOKENS. Provider said: ${err.message}`;
      }
      if (err instanceof OpenAI.BadRequestError) {
        return `${opts.id} rejected the request: ${err.message}`;
      }
      if (err instanceof OpenAI.APIError) {
        return `${opts.id} API error ${err.status}: ${err.message}`;
      }
      return err instanceof Error ? err.message : String(err);
    },

    isRateLimited(err) {
      return err instanceof OpenAI.RateLimitError;
    },
  };

  return provider;
}

function toOpenAiTool(tool: LlmToolDef): OpenAI.Chat.ChatCompletionTool {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.schema,
    },
  };
}

function toTurn(choice: OpenAI.Chat.ChatCompletion.Choice, usage: TokenUsage): LlmTurn {
  const toolCalls = (choice.message.tool_calls ?? []).flatMap((call) => {
    if (call.type !== "function") return [];
    return [{ id: call.id, name: call.function.name, input: parseArguments(call.function.arguments) }];
  });

  return {
    text: choice.message.content?.trim() ?? "",
    toolCalls,
    stopReason: mapStop(choice.finish_reason, toolCalls.length > 0),
    refusalReason: choice.message.refusal ?? undefined,
    usage,
  };
}

function usageOf(response: OpenAI.Chat.ChatCompletion): TokenUsage {
  if (!response.usage) return emptyUsage();
  return { inputTokens: response.usage.prompt_tokens, outputTokens: response.usage.completion_tokens };
}

/**
 * Open models emit tool arguments as a JSON string and get it wrong often
 * enough to matter — a trailing comma or an unquoted key would otherwise throw
 * inside the agent loop. An empty object lets the tool fail with a real
 * validation message the model can actually recover from.
 */
function parseArguments(raw: string): Record<string, unknown> {
  if (!raw?.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function mapStop(reason: OpenAI.Chat.ChatCompletion.Choice["finish_reason"], hasTools: boolean): StopReason {
  switch (reason) {
    case "tool_calls":
    case "function_call":
      return "tool_use";
    case "length":
      return "max_tokens";
    case "content_filter":
      return "refusal";
    case "stop":
      return hasTools ? "tool_use" : "end";
    default:
      return hasTools ? "tool_use" : "other";
  }
}

/** Used by the capabilities endpoint to show which models a key can reach. */
export async function listModels(baseURL: string, apiKey: string): Promise<string[]> {
  try {
    const client = new OpenAI({ apiKey, baseURL, maxRetries: 0 });
    const models = await client.models.list();
    return models.data.map((m) => m.id).sort();
  } catch {
    return [];
  }
}
