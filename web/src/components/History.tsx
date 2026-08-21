import { useCallback, useEffect, useState } from "react";
import { clearRunHistory, fetchRunHistory, forgetRun } from "../api";
import { PLATFORM_GLYPH, type RunSummary } from "../types";

interface Props {
  activeId: string | null;
  /** Bumped by the parent whenever a run finishes, to trigger a refetch. */
  refreshKey: number;
  onSelect: (id: string) => void;
  /** Called after history changes, so the parent can drop a cleared run. */
  onCleared?: (removedIds: string[]) => void;
}

/**
 * Past runs, newest first. Backed by the server's persisted-run store, so
 * this survives a page reload the way the rest of the app now does too.
 */
export function History({ activeId, refreshKey, onSelect, onCleared }: Props) {
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRuns(await fetchRunHistory());
    } catch {
      setRuns([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  // Leaving the confirm state armed is a trap: come back to the tab later,
  // click what you think is "Clear history", and it fires immediately.
  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(false), 5000);
    return () => clearTimeout(timer);
  }, [confirming]);

  const clearAll = useCallback(async () => {
    setBusy(true);
    setNote(null);
    const removed = (runs ?? []).map((run) => run.id);
    try {
      const { cleared, kept } = await clearRunHistory();
      setConfirming(false);
      await load();
      onCleared?.(removed);
      setNote(
        kept > 0
          ? `Cleared ${cleared}. Kept ${kept} still running.`
          : `Cleared ${cleared} run${cleared === 1 ? "" : "s"}.`,
      );
    } catch {
      setNote("Could not clear history.");
    } finally {
      setBusy(false);
    }
  }, [load, onCleared, runs]);

  const remove = useCallback(
    async (id: string) => {
      try {
        await forgetRun(id);
        await load();
        onCleared?.([id]);
      } catch {
        setNote("Could not remove that run — it may still be in flight.");
      }
    },
    [load, onCleared],
  );

  if (!runs || runs.length === 0) {
    return note ? (
      <section className="history" aria-label="Run history">
        <p className="history__note" role="status">
          {note}
        </p>
      </section>
    ) : null;
  }

  return (
    <section className="history" aria-label="Run history">
      <div className="history__head">
        <h3 className="history__title">History</h3>
        {confirming ? (
          <span className="history__confirm">
            <button className="btn btn--danger" type="button" onClick={clearAll} disabled={busy} autoFocus>
              {busy ? "Clearing…" : `Clear ${runs.length}`}
            </button>
            <button className="btn btn--ghost" type="button" onClick={() => setConfirming(false)} disabled={busy}>
              Cancel
            </button>
          </span>
        ) : (
          <button className="btn btn--ghost history__clear" type="button" onClick={() => setConfirming(true)}>
            Clear
          </button>
        )}
      </div>

      {confirming && (
        <p className="history__note" role="status">
          Forgets these runs and their logs. Generated suites under <code>clients/</code> are not affected.
        </p>
      )}
      {note && !confirming && (
        <p className="history__note" role="status">
          {note}
        </p>
      )}

      <ul className="history__list">
        {runs.map((run) => (
          <li key={run.id} className="history__row">
            <button
              type="button"
              className="history__item"
              data-active={run.id === activeId || undefined}
              onClick={() => onSelect(run.id)}
            >
              <span className="history__glyphs" aria-hidden="true">
                {run.platforms.map((p) => (
                  <span key={p} data-status={run.statuses[p]}>
                    {PLATFORM_GLYPH[p]}
                  </span>
                ))}
              </span>
              <span className="history__prompt">{run.prompt}</span>
              <span className="history__time">{new Date(run.createdAt).toLocaleTimeString()}</span>
            </button>
            <button
              type="button"
              className="history__remove"
              onClick={() => remove(run.id)}
              aria-label={`Remove run: ${run.prompt.slice(0, 60)}`}
              title="Remove this run"
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
