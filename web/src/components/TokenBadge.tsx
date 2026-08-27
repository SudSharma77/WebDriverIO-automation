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
 *
 * usageByProvider breaks that same total down by which provider actually
 * served each call - most runs only ever touch one, but a run that fell back
 * from a primary provider to a secondary one (see synthesize.ts) spends on
 * both, and the hover tooltip is the place to see that split.
 */
export function TokenBadge({ usage, usageByProvider }: { usage: TokenUsage; usageByProvider?: Record<string, TokenUsage> }) {
  const total = usage.inputTokens + usage.outputTokens;
  if (total === 0) return null;

  const providers = Object.entries(usageByProvider ?? {}).filter(([, u]) => u.inputTokens + u.outputTokens > 0);

  let title = `${usage.inputTokens.toLocaleString()} input + ${usage.outputTokens.toLocaleString()} output tokens`;
  if (providers.length > 1) {
    const lines = providers.map(
      ([provider, u]) => `  ${provider}: ${u.inputTokens.toLocaleString()} in / ${u.outputTokens.toLocaleString()} out`,
    );
    title += `\n\nBy provider:\n${lines.join("\n")}`;
  }

  return (
    <span className="token-badge" title={title}>
      ~{formatCount(total)} tokens
    </span>
  );
}
