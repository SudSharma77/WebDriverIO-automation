import { config } from "../../config.js";
import { createAnthropicProvider } from "./anthropic.js";
import { createOpenAiCompatibleProvider, listModels } from "./openai-compatible.js";
import type { LlmProvider } from "./types.js";

export type { LlmConversation, LlmProvider, LlmToolDef, LlmToolCall, LlmToolResult, LlmTurn } from "./types.js";

/**
 * Single provider for the process, built once from config.
 *
 * Both SDKs are safe to share across concurrent lanes and keep their own
 * connection pooling and retry policy.
 */
export const llm: LlmProvider = build();

function build(): LlmProvider {
  const { provider, apiKey, model, baseURL, supportsVision, maxRetries } = config.llm;

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
  });
}

/** Models the configured key can actually reach — surfaced by /api/capabilities. */
export async function availableModels(): Promise<string[]> {
  if (config.llm.provider === "anthropic" || !config.llm.baseURL) return [];
  return listModels(config.llm.baseURL, config.llm.apiKey);
}
