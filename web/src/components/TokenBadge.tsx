import type { TokenUsage } from "../types";

/** 1234 -> "1.2k", 950 -> "950". Just enough precision to be readable at a glance. */
function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
  return `${Math.round(n / 1000)}k`;
}

/**
 * How many tokens this lane has actually spent so far - across exploration,
 * structure, code generation, lint fixes, repair, and the failure summary.
 * Updates live as the run progresses, not just once at the end.
 */
export function TokenBadge({ usage }: { usage: TokenUsage }) {
  const total = usage.inputTokens + usage.outputTokens;
  if (total === 0) return null;

  return (
    <span
      className="token-badge"
      title={`${usage.inputTokens.toLocaleString()} input + ${usage.outputTokens.toLocaleString()} output tokens`}
    >
      ~{formatCount(total)} tokens
    </span>
  );
}
