import { RAIL_PHASES, type LaneStatus, type Phase } from "../types";

const SHORT: Partial<Record<Phase, string>> = {
  preflight: "check",
  explore: "explore",
  export: "export",
  synthesize: "write",
  verify: "verify",
};

/**
 * The run's progress at a glance: five pips, filled behind the current phase.
 *
 * This is the one place motion is used — a sweep on the active pip. Everything
 * else changes state without animating, so the eye goes straight to whatever is
 * actually working.
 */
export function PhaseRail({ phase, status }: { phase: Phase; status: LaneStatus }) {
  const index = RAIL_PHASES.indexOf(phase);
  const finished = status === "passed" || status === "failed";
  const stalled = status === "skipped" || status === "error" || status === "queued";

  const stateFor = (i: number): "done" | "active" | "todo" => {
    if (finished || phase === "done") return "done";
    if (stalled) return "todo";
    if (index < 0) return "todo";
    if (i < index) return "done";
    if (i === index) return "active";
    return "todo";
  };

  return (
    <div className="rail" role="group" aria-label={`Progress: ${phase}`}>
      {RAIL_PHASES.map((p, i) => (
        <div key={p} className="rail__pip" data-state={stateFor(i)}>
          <span className="rail__bar" />
          <span className="rail__label">{SHORT[p] ?? p}</span>
        </div>
      ))}
    </div>
  );
}
