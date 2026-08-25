import { useCallback, useEffect, useState } from "react";
import { ApiError, approveReview, fetchReview, fetchReviews, rejectReview } from "../api";
import type { ReviewRequest } from "../types";

/**
 * The gate between a passing run and a client's repository.
 *
 * A run that passes proves the spec works. It does not prove the team wants
 * it, named the way they name things, asserting what they meant. So every
 * change is committed locally and waits here until a person reads the diff.
 *
 * Both decisions are final and neither is undoable from this screen, which is
 * why both ask who is making it: this record is the only account of who
 * approved what.
 */
export function Reviews({ clientId }: { clientId: string }) {
  const [reviews, setReviews] = useState<ReviewRequest[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [diff, setDiff] = useState<string | null>(null);
  const [reviewer, setReviewer] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setReviews(await fetchReviews(clientId));
    } catch {
      setReviews([]);
      setNote("Could not load the review queue.");
    }
  }, [clientId]);

  useEffect(() => {
    void load();
  }, [load]);

  const openReview = useCallback(
    async (id: string) => {
      if (open === id) {
        setOpen(null);
        setDiff(null);
        return;
      }
      setOpen(id);
      setDiff(null);
      try {
        const { diff: text } = await fetchReview(clientId, id);
        setDiff(text ?? "(no diff available — the commit may have been removed)");
      } catch {
        setDiff("(could not load the diff)");
      }
    },
    [clientId, open],
  );

  async function decide(id: string, approve: boolean) {
    if (!reviewer.trim()) {
      setNote("Add your name first — this is the record of who decided.");
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      const decide = approve ? approveReview : rejectReview;
      const updated = await decide(clientId, id, reviewer.trim());
      setNote(
        updated.status === "pushed"
          ? `Pushed. ${updated.files.length} file${updated.files.length === 1 ? "" : "s"} are now on the update branch.`
          : updated.status === "rejected"
            ? "Rejected, and the change has been removed from the project."
            : `Approved, but the push failed: ${updated.error ?? "unknown error"}. It can be retried.`,
      );
      await load();
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const pending = reviews?.filter((r) => r.status === "pending") ?? [];
  const decided = reviews?.filter((r) => r.status !== "pending") ?? [];

  return (
    <section className="reviews" aria-label="Review queue">
      <div className="reviews__head">
        <h4 className="reviews__title">Awaiting review{pending.length > 0 ? ` · ${pending.length}` : ""}</h4>
        <label className="reviews__who">
          <span>Your name</span>
          <input
            value={reviewer}
            onChange={(event) => setReviewer(event.target.value)}
            placeholder="e.g. Priya"
            aria-label="Reviewer name"
          />
        </label>
      </div>

      {note && (
        <p className="reviews__note" role="status">
          {note}
        </p>
      )}

      {reviews === null && <p className="reviews__empty">Loading…</p>}

      {reviews !== null && pending.length === 0 && (
        <p className="reviews__empty">
          Nothing waiting. Changes appear here as runs pass, and stay until someone approves or rejects them.
        </p>
      )}

      <ul className="reviews__list">
        {pending.map((review) => (
          <li key={review.id} className="reviews__item">
            <button
              type="button"
              className="reviews__summary"
              onClick={() => void openReview(review.id)}
              aria-expanded={open === review.id}
            >
              <span className="reviews__scenario">{review.title}</span>
              <span className="reviews__meta">
                {review.platform} · {review.files.length} file{review.files.length === 1 ? "" : "s"} ·{" "}
                {new Date(review.createdAt).toLocaleString()}
              </span>
            </button>

            {open === review.id && (
              <div className="reviews__detail">
                <ul className="reviews__files">
                  {review.files.map((file) => (
                    <li key={file.path}>
                      <span className="reviews__status" data-status={file.status}>
                        {file.status}
                      </span>
                      <code>{file.path}</code>
                    </li>
                  ))}
                </ul>

                <pre className="reviews__diff">{diff ?? "Loading diff…"}</pre>

                <div className="reviews__actions">
                  <button type="button" disabled={busy} onClick={() => void decide(review.id, true)}>
                    Approve and push
                  </button>
                  <button type="button" className="reviews__reject" disabled={busy} onClick={() => void decide(review.id, false)}>
                    Reject
                  </button>
                  <span className="reviews__warning">
                    Rejecting removes this change from the project, not just from the queue — the scenario can be run again.
                  </span>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>

      {decided.length > 0 && (
        <details className="reviews__history">
          <summary>Decided · {decided.length}</summary>
          <ul>
            {decided.map((review) => (
              <li key={review.id}>
                <span className="reviews__scenario">{review.title}</span>
                <span className="reviews__meta">
                  {review.status} by {review.reviewer ?? "unknown"}
                  {review.decidedAt ? ` · ${new Date(review.decidedAt).toLocaleString()}` : ""}
                  {review.error ? ` · ${review.error}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
