import { config } from "../../config.js";
import { createAnthropicProvider } from "./anthropic.js";
import { createOpenAiCompatibleProvider, listModels } from "./openai-compatible.js";
import type { LlmProvider } from "./types.js";

export type { LlmConversation, LlmProvider, LlmToolDef, LlmToolCall, LlmToolResult, LlmTurn } from "./types.js";

/**
 * Primary provider for the process, built once from config.
 *
 * Both SDKs are safe to share across concurrent lanes and keep their own
 * connection pooling and retry policy.
 */
export const llm: LlmProvider = build(config.llm.model);

/**
 * Same provider and key, a different model - built lazily only if
 * LLM_FALLBACK_MODEL is set, and tried once by synthesis/repair on a 429 from
 * the primary model. Not wired into the live exploration loop: that is a
 * stateful multi-turn conversation, and swapping providers mid-conversation
 * risks losing turn history in a way a stateless one-shot call does not.
 */
export const llmFallback: LlmProvider | null = config.llm.fallbackModel
  ? build(config.llm.fallbackModel)
  : null;

function build(model: string): LlmProvider {
  const { provider, apiKey, baseURL, supportsVision, maxRetries } = config.llm;

  if (provider === "anthropic") {
    return createAnthropicProvider({ apiKey, model, maxRetries });
  }

  return createOpenAiCompatibleProvider({
    id: provider,
    apiKey,
    baseURL: baseURL!,
    model,
    supportsVision,
    maxRetries,
    // Google's compatibility layer documents the older field name.
    tokenParam: provider === "gemini" ? "max_tokens" : "max_completion_tokens",
  });
}

/** Models the configured key can actually reach — surfaced by /api/capabilities. */
export async function availableModels(): Promise<string[]> {
  if (config.llm.provider === "anthropic" || !config.llm.baseURL) return [];
  return listModels(config.llm.baseURL, config.llm.apiKey);
}
