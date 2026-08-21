import { runLane } from "./lanes/lane.js";
import { store } from "./store.js";
import type { CreateRunInput, RunState } from "./types.js";

const inFlight = new Map<string, AbortController>();

/**
 * Start a run and return immediately - the client follows progress over SSE.
 *
 * Lanes are launched together and settled independently: one platform failing
 * (no Appium, no farm credentials, a genuinely broken scenario) must never stop
 * the others from producing their artifact.
 */
export function startRun(input: CreateRunInput): RunState {
  const run = store.create(input);
  const controller = new AbortController();
  inFlight.set(run.id, controller);

  void (async () => {
    try {
      await Promise.allSettled(
        run.order.map((platform) => runLane({ run, platform, signal: controller.signal })),
      );
    } finally {
      inFlight.delete(run.id);
      store.emit(run.id, { type: "run.done", runId: run.id });
      // Artifacts outlive the run for the audit trail; the credentials that
      // produced them must not. In finally so cancellation and crashes clear
      // them too, not just the happy path.
      store.forgetSecrets(run.id);
    }
  })();

  return run;
}

export function cancelRun(runId: string): boolean {
  const controller = inFlight.get(runId);
  if (!controller) return false;
  controller.abort();
  return true;
}

export function isRunning(runId: string): boolean {
  return inFlight.has(runId);
}

/** Abort everything on shutdown so no emulator or cloud device is left held. */
export function cancelAll(): void {
  for (const controller of inFlight.values()) controller.abort();
  inFlight.clear();
}
