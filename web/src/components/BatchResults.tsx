import { useEffect, useState } from "react";
import { fetchBatch } from "../api";
import type { BatchState, RunSummary } from "../types";
import { StatusPill } from "./StatusPill";

interface Props {
  batchId: string;
  onOpenRun: (id: string) => void;
}

/**
 * Polls rather than streams: a batch spans many runs over minutes, and each
 * run already has its own SSE stream when you open it — the batch view only
 * needs a coarse "where are we" table, not a live blow-by-blow.
 */
export function BatchResults({ batchId, onOpenRun }: Props) {
  const [batch, setBatch] = useState<BatchState | null>(null);
  const [runs, setRuns] = useState<RunSummary[]>([]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      try {
        const data = await fetchBatch(batchId);
        if (cancelled) return;
        setBatch(data.batch);
        setRuns(data.runs);
        if (!data.batch.finishedAt) timer = setTimeout(poll, 2500);
      } catch {
        if (!cancelled) timer = setTimeout(poll, 4000);
      }
    };
    void poll();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [batchId]);

  if (!batch) return null;

  const done = runs.filter((r) => r.finishedAt).length;
  const passed = runs.filter((r) => Object.values(r.statuses).every((s) => s === "passed")).length;
  const failed = runs.filter((r) => Object.values(r.statuses).some((s) => s === "failed" || s === "error")).length;

  return (
    <div className="batch">
      <div className="run-header">
        <h2>Batch of {batch.caseCount} test case{batch.caseCount === 1 ? "" : "s"}</h2>
        <span className="run-header__id" role="status">
          {done}/{batch.caseCount} done · {passed} passed · {failed} failed
          {!batch.finishedAt ? " · running…" : ""}
        </span>
      </div>

      <div className="batch__table-wrap">
        <table className="batch__table">
          <thead>
            <tr>
              <th>#</th>
              <th>Test case</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {batch.runIds.map((id, i) => {
              const run = runs.find((r) => r.id === id);
              const status = run ? (run.platforms.map((p) => run.statuses[p]).find((s) => s) ?? "queued") : "queued";
              const reason =
                run && (status === "failed" || status === "error")
                  ? run.platforms.map((p) => run.details?.[p]).find((d) => d)
                  : undefined;
              return (
                <tr key={id}>
                  <td>{i + 1}</td>
                  <td className="batch__prompt">
                    {run?.prompt ?? "…"}
                    {reason && <div className="batch__reason">{reason}</div>}
                  </td>
                  <td>
                    <StatusPill status={status} />
                  </td>
                  <td>
                    <button className="btn btn--ghost" type="button" onClick={() => onOpenRun(id)} disabled={!run}>
                      View
                    </button>
                  </td>
                </tr>
              );
            })}
            {batch.runIds.length < batch.caseCount &&
              Array.from({ length: batch.caseCount - batch.runIds.length }).map((_, i) => (
                <tr key={`pending-${i}`}>
                  <td>{batch.runIds.length + i + 1}</td>
                  <td className="batch__prompt">Queued…</td>
                  <td>
                    <StatusPill status="queued" />
                  </td>
                  <td></td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
