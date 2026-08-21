import { useEffect, useRef, useState } from "react";
import type { LaneStatus } from "../types";

const LABEL: Record<LaneStatus, string> = {
  queued: "Queued",
  running: "Running",
  passed: "Passed",
  failed: "Failed",
  skipped: "Skipped",
  error: "Error",
};

/** Which arrivals are worth a landing animation - not every status change is news. */
const LANDING: Partial<Record<LaneStatus, "land-pass" | "land-fail">> = {
  passed: "land-pass",
  failed: "land-fail",
  error: "land-fail",
};

export function StatusPill({ status }: { status: LaneStatus }) {
  const [land, setLand] = useState<string | null>(null);
  const prev = useRef(status);

  useEffect(() => {
    if (prev.current !== status) {
      const animation = LANDING[status];
      if (animation) {
        setLand(animation);
        const timer = setTimeout(() => setLand(null), 700);
        prev.current = status;
        return () => clearTimeout(timer);
      }
    }
    prev.current = status;
  }, [status]);

  return (
    <span className="pill" data-status={status} data-land={land ?? undefined}>
      <span className="pill__dot" aria-hidden="true" />
      {LABEL[status]}
    </span>
  );
}
