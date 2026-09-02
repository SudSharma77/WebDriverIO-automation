import type { PendingReviews } from "../api";

/**
 * Points at the review queue that already lives on the Clients tab - this is
 * purely a "something needs your attention" signal, not a second place to
 * approve or reject. Visible from any tab, so a reviewer who has no reason to
 * go looking at Clients on their own still sees it.
 */
export function PendingReviewsBanner({ pending, onReview }: { pending: PendingReviews; onReview: () => void }) {
  if (pending.total === 0) return null;

  const clientCount = pending.clients.length;

  return (
    <div className="banner" data-tone="warn" role="status">
      <span>
        {pending.total} change{pending.total === 1 ? "" : "s"} across {clientCount} client{clientCount === 1 ? "" : "s"}{" "}
        {pending.total === 1 ? "is" : "are"} waiting for review before {pending.total === 1 ? "it" : "they"} can reach
        GitHub.
      </span>
      <button type="button" className="btn btn--ghost" onClick={onReview}>
        Review now
      </button>
    </div>
  );
}
