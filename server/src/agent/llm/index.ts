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
export const llm: LlmProvider = build({
  provider: config.llm.provider,
  apiKey: config.llm.apiKey,
  baseURL: config.llm.baseURL,
  model: config.llm.model,
  supportsVision: config.llm.supportsVision,
  maxRetries: config.llm.maxRetries,
});

/**
 * Same provider and key, a different model - built lazily only if
 * LLM_FALLBACK_MODEL is set, and tried once by synthesis/repair on a 429 from
 * the primary model. Not wired into the live exploration loop: that is a
 * stateful multi-turn conversation, and swapping providers mid-conversation
 * risks losing turn history in a way a stateless one-shot call does not.
 */
export const llmFallback: LlmProvider | null = config.llm.fallbackModel
  ? build({
      provider: config.llm.provider,
      apiKey: config.llm.apiKey,
      baseURL: config.llm.baseURL,
      model: config.llm.fallbackModel,
      supportsVision: config.llm.supportsVision,
      maxRetries: config.llm.maxRetries,
    })
  : null;

/**
 * A genuinely different provider - not just a different model on the same
 * one - built lazily only if SECONDARY_LLM_PROVIDER is set. Tried once by
 * synthesize/repair as a last resort after the primary provider itself keeps
 * failing (timeouts, 504s), which llmFallback above cannot help with since it
 * shares the primary's own endpoint. Same "not wired into explore" reasoning
 * applies.
 */
export const llmSecondary: LlmProvider | null = config.secondary
  ? build({
      provider: config.secondary.provider,
      apiKey: config.secondary.apiKey,
      baseURL: config.secondary.baseURL,
      model: config.secondary.model,
      // Synthesize-class calls are text-only (see synthesize.ts's `complete`) -
      // no image turns are ever built for this provider to support or not.
      supportsVision: false,
      maxRetries: config.secondary.maxRetries,
    })
  : null;

function build(opts: {
  provider: string;
  apiKey: string;
  baseURL: string | null;
  model: string;
  supportsVision: boolean;
  maxRetries: number;
}): LlmProvider {
  if (opts.provider === "anthropic") {
    return createAnthropicProvider({ apiKey: opts.apiKey, model: opts.model, maxRetries: opts.maxRetries });
  }

  return createOpenAiCompatibleProvider({
    id: opts.provider,
    apiKey: opts.apiKey,
    baseURL: opts.baseURL!,
    model: opts.model,
    supportsVision: opts.supportsVision,
    maxRetries: opts.maxRetries,
    // Google's compatibility layer documents the older field name.
    tokenParam: opts.provider === "gemini" ? "max_tokens" : "max_completion_tokens",
  });
}

/** Models the configured key can actually reach — surfaced by /api/capabilities. */
export async function availableModels(): Promise<string[]> {
  if (config.llm.provider === "anthropic" || !config.llm.baseURL) return [];
  return listModels(config.llm.baseURL, config.llm.apiKey);
}
