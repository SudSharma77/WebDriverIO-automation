/**
 * Provider-neutral LLM surface.
 *
 * The explore loop needs exactly two things from a model: multi-turn tool
 * calling, and a one-shot completion. Everything else (message shapes, tool
 * schemas, how images attach to a tool result) differs enough between the
 * Anthropic and OpenAI-compatible APIs that it belongs behind an adapter
 * rather than in `if (provider === …)` branches at the call site.
 */

export interface LlmToolDef {
  name: string;
  description: string;
  /** JSON Schema for the tool's arguments, as advertised by MCP. */
  schema: Record<string, unknown>;
}

export interface LlmToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface LlmToolResult {
  id: string;
  name: string;
  text: string;
  /** data: URLs. Only sent to the model when the provider supports vision. */
  images: string[];
  isError: boolean;
}

export type StopReason = "end" | "tool_use" | "max_tokens" | "refusal" | "other";

/** Both providers report this per response; kept to the two numbers every billing model actually cares about. */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export function emptyUsage(): TokenUsage {
  return { inputTokens: 0, outputTokens: 0 };
}

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return { inputTokens: a.inputTokens + b.inputTokens, outputTokens: a.outputTokens + b.outputTokens };
}

export interface LlmTurn {
  text: string;
  toolCalls: LlmToolCall[];
  stopReason: StopReason;
  refusalReason?: string;
  usage: TokenUsage;
}

/**
 * A stateful conversation.
 *
 * Each adapter keeps history in its own native shape, because both APIs are
 * strict about what must be echoed back verbatim — Anthropic needs thinking
 * blocks preserved on the assistant turn, OpenAI needs the exact `tool_calls`
 * array it emitted. Normalising history into a neutral format and rebuilding it
 * each turn is how subtle 400s get introduced.
 */
export interface LlmConversation {
  /** Send the opening prompt (string) or the results of the last tool calls. */
  send(input: string | LlmToolResult[]): Promise<LlmTurn>;
}

export interface CompleteTurn {
  role: "user" | "assistant";
  text: string;
}

export interface LlmProvider {
  /** Stable id used in logs and the UI, e.g. "anthropic" or "groq". */
  readonly id: string;
  readonly model: string;
  /** Whether screenshots can usefully be fed back to this model. */
  readonly supportsVision: boolean;

  startConversation(opts: {
    system: string;
    tools: LlmToolDef[];
    maxTokens: number;
    /** Suppresses image blocks even on a vision model, to save tokens. */
    sendImages: boolean;
  }): LlmConversation;

  /** One-shot multi-turn completion. Used by synthesis and repair. */
  complete(opts: { system: string; turns: CompleteTurn[]; maxTokens: number }): Promise<{ text: string; usage: TokenUsage }>;

  /** Turn a provider error into something a user can act on. */
  describeError(err: unknown): string;

  /** Whether this error is the provider's own 429, so a fallback model is worth trying. */
  isRateLimited(err: unknown): boolean;
}
