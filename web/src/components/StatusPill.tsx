import type { LaneStatus } from "../types";

const LABEL: Record<LaneStatus, string> = {
  queued: "Queued",
  running: "Running",
  passed: "Passed",
  failed: "Failed",
  skipped: "Skipped",
  error: "Error",
};

export function StatusPill({ status }: { status: LaneStatus }) {
  return (
    <span className="pill" data-status={status}>
      <span className="pill__dot" aria-hidden="true" />
      {LABEL[status]}
    </span>
  );
}
