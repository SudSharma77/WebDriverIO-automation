import { useEffect, useState } from "react";
import { fetchRunHistory } from "../api";
import { PLATFORM_GLYPH, type RunSummary } from "../types";

interface Props {
  activeId: string | null;
  /** Bumped by the parent whenever a run finishes, to trigger a refetch. */
  refreshKey: number;
  onSelect: (id: string) => void;
}

/**
 * Past runs, newest first. Backed by the server's persisted-run store, so
 * this survives a page reload the way the rest of the app now does too.
 */
export function History({ activeId, refreshKey, onSelect }: Props) {
  const [runs, setRuns] = useState<RunSummary[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchRunHistory()
      .then((r) => {
        if (!cancelled) setRuns(r);
      })
      .catch(() => {
        if (!cancelled) setRuns([]);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  if (!runs || runs.length === 0) return null;

  return (
    <section className="history" aria-label="Run history">
      <h3 className="history__title">History</h3>
      <ul className="history__list">
        {runs.map((run) => (
          <li key={run.id}>
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
          </li>
        ))}
      </ul>
    </section>
  );
}
