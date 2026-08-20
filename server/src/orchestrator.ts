import { extendLane, runLane } from "./lanes/lane.js";
import { store } from "./store.js";
import type { CreateRunInput, Platform, RunState } from "./types.js";

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
    }
  })();

  return run;
}

/**
 * Extend an already-passing lane with additional steps, as its own new run
 * (own history entry, own artifacts) rather than mutating the original.
 * Fails closed on anything that would make the shortcut unsafe: no base run,
 * wrong lane, or the base lane never actually passed.
 */
export function startExtend(
  baseRunId: string,
  platform: Platform,
  additionalPrompt: string,
): { run: RunState } | { error: string } {
  const baseRun = store.get(baseRunId);
  if (!baseRun) return { error: "Base run not found." };

  const baseLane = baseRun.lanes[platform];
  if (!baseLane) return { error: `The base run has no ${platform} lane.` };
  if (baseLane.status !== "passed") return { error: "Only a passed lane can be extended." };
  if (!baseLane.specCode) return { error: "The base lane has no spec to extend." };

  const run = store.create({
    prompt: `${baseRun.prompt.trim()} Then, ${additionalPrompt.trim()}`,
    platforms: [platform],
    target: baseRun.target,
    headless: baseRun.headless,
    stabilityRuns: baseRun.stabilityRuns,
  });

  const controller = new AbortController();
  inFlight.set(run.id, controller);

  void (async () => {
    try {
      await extendLane({ run, platform, baseLane, additionalPrompt, signal: controller.signal });
    } finally {
      inFlight.delete(run.id);
      store.emit(run.id, { type: "run.done", runId: run.id });
    }
  })();

  return { run };
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
