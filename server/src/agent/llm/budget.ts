/**
 * Request-size budgeting for providers with a hard per-request ceiling.
 *
 * Free tiers bill (and reject) on `prompt + reserved output`, and the explore
 * loop grows its history monotonically — every turn appends an assistant
 * message plus its tool results, and nothing ever removes one. On a large
 * budget that is merely wasteful; on Groq's free tier (8k tokens/minute, of
 * which the MCP tool schemas alone are ~1.6k) it is fatal within a handful of
 * turns.
 *
 * So history is trimmed from the oldest end before each request. The agent
 * keeps its instructions and its objective — which is what it needs to stay on
 * task — and loses the middle of its scrollback, which it has already folded
 * into the transcript the synthesis phase reads.
 */

/**
 * Rough token count for anything JSON-serialisable.
 *
 * Deliberately pessimistic: the usual "chars / 4" rule holds for prose, but
 * this is mostly HTML fragments, CSS selectors and JSON, which tokenise closer
 * to 3 characters each. Overestimating costs a little history; underestimating
 * costs the whole request with a 413.
 */
export function estimateTokens(value: unknown): number {
  if (value === undefined || value === null) return 0;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return Math.ceil((text?.length ?? 0) / 3.5);
}

export function estimateMessages(messages: readonly unknown[]): number {
  let total = 0;
  for (const message of messages) total += estimateTokens(message);
  return total;
}

export interface TrimOptions<T> {
  /**
   * Estimated tokens for everything outside `messages` — tool schemas, a
   * system block held separately from history, and the reserved output.
   */
  overhead: number;
  /** Hard ceiling for the whole request. Zero or less disables trimming. */
  budget: number;
  /**
   * Leading messages that must never be dropped: the system prompt (where the
   * adapter keeps it in-band) and the opening task. Without the task pinned the
   * agent forgets what it was asked to do.
   */
  pinned: number;
  /**
   * True for a message that opens a new droppable group. Groups run from one
   * assistant message up to (not including) the next, so an assistant turn and
   * the tool results answering it are always dropped together — both APIs
   * reject a tool result whose originating tool call is missing.
   */
  startsGroup: (message: T) => boolean;
}

/**
 * Drop whole oldest groups, in place, until the request fits.
 *
 * Mutates the array the adapter is holding rather than returning a copy: both
 * adapters append to a long-lived `messages` array and re-send it each turn.
 *
 * The newest group is never dropped — a request with no recent context is
 * useless, and if even that does not fit, the caller has a tool result too
 * large to send and needs a smaller `maxToolResultChars`, not less history.
 */
export function trimHistory<T>(messages: T[], opts: TrimOptions<T>): number {
  const { overhead, budget, pinned, startsGroup } = opts;
  if (budget <= 0) return 0;

  let dropped = 0;

  while (overhead + estimateMessages(messages) > budget) {
    const first = boundaryAt(messages, pinned, startsGroup);
    if (first < 0) break;

    const next = boundaryAt(messages, first + 1, startsGroup);
    if (next < 0) break; // Only one group left — keep it.

    messages.splice(first, next - first);
    dropped += next - first;
  }

  return dropped;
}

function boundaryAt<T>(messages: readonly T[], from: number, startsGroup: (m: T) => boolean): number {
  for (let i = Math.max(from, 0); i < messages.length; i += 1) {
    const message = messages[i];
    if (message !== undefined && startsGroup(message)) return i;
  }
  return -1;
}
