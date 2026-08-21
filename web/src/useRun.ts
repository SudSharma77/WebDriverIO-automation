import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { streamRun } from "./api";
import type { LaneState, RunEvent, RunState } from "./types";

/**
 * Fold the event stream into run state.
 *
 * The server sends a full snapshot on connect and then deltas, so this mirrors
 * the server reducer. Keeping it a pure reducer means a reconnect (which
 * replays snapshot + log) converges on exactly the same state.
 */
function reduce(state: RunState | null, event: RunEvent): RunState | null {
  if (event.type === "run.snapshot") return event.run;
  if (!state) return state;

  if (event.type === "run.done") {
    return { ...state, finishedAt: state.finishedAt ?? Date.now() };
  }
  if (!("platform" in event) || !event.platform) return state;

  const lane = state.lanes[event.platform];
  if (!lane) return state;

  const next = applyToLane(lane, event);
  if (next === lane) return state;

  return { ...state, lanes: { ...state.lanes, [event.platform]: next } };
}

function applyToLane(lane: LaneState, event: RunEvent): LaneState {
  switch (event.type) {
    case "lane.phase":
      return { ...lane, phase: event.phase };
    case "lane.status":
      return { ...lane, status: event.status, detail: event.detail ?? lane.detail };
    case "agent.text":
      return { ...lane, narration: [...(lane.narration ?? []), event.text] };
    case "agent.tool":
      return { ...lane, steps: [...lane.steps, event.step], toolCallCount: lane.toolCallCount + 1 };
    case "agent.tool_result":
      return {
        ...lane,
        steps: lane.steps.map((step) =>
          step.id === event.id ? { ...step, ok: event.ok, summary: event.summary } : step,
        ),
      };
    case "screenshot":
      return { ...lane, screenshots: [...lane.screenshots, event.shot] };
    case "artifact":
      return event.kind === "recorded"
        ? { ...lane, recordedCode: event.code }
        : { ...lane, specCode: event.code, specPath: event.path ?? lane.specPath };
    case "verify.log":
      return { ...lane, verifyLog: [...lane.verifyLog, event.line] };
    case "lane.reuse":
      return { ...lane, reuse: { mode: event.mode, reason: event.reason } };
    case "lane.saved":
      return { ...lane, saved: event.report };
    case "lane.usage":
      return {
        ...lane,
        usage: {
          inputTokens: lane.usage.inputTokens + event.usage.inputTokens,
          outputTokens: lane.usage.outputTokens + event.usage.outputTokens,
        },
      };
    default:
      return lane;
  }
}

export interface UseRun {
  run: RunState | null;
  streamError: string | null;
  /** Latest agent-level error, shown as a banner above the lanes. */
  runError: string | null;
  watch: (runId: string, seed?: RunState) => void;
  reset: () => void;
}

export function useRun(): UseRun {
  const [run, dispatch] = useReducer(reduce, null);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const closeRef = useRef<(() => void) | null>(null);
  // { runId, generation } rather than a bare string: calling watch() again for
  // the *same* run id (e.g. reconnecting after a regression re-check flips a
  // finished run's lane back to "running") must still force a fresh SSE
  // connection, and React would otherwise collapse an identical string value
  // back to itself with no observable change for the effect to react to.
  const [watching, setWatching] = useState<{ runId: string; generation: number } | null>(null);

  const watch = useCallback((runId: string, seed?: RunState) => {
    setStreamError(null);
    setRunError(null);
    if (seed) dispatch({ type: "run.snapshot", run: seed });
    setWatching((prev) => ({ runId, generation: (prev?.runId === runId ? prev.generation : 0) + 1 }));
  }, []);

  const reset = useCallback(() => {
    closeRef.current?.();
    closeRef.current = null;
    setWatching(null);
    setStreamError(null);
    setRunError(null);
  }, []);

  useEffect(() => {
    if (!watching) return;

    const close = streamRun(watching.runId, {
      onEvent: (event) => {
        if (event.type === "error") setRunError(event.message);
        dispatch(event);
      },
      onError: setStreamError,
    });
    closeRef.current = close;

    return () => {
      close();
      closeRef.current = null;
    };
  }, [watching]);

  return { run, streamError, runError, watch, reset };
}
