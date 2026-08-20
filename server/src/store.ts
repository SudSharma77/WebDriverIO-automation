import { randomUUID } from "node:crypto";
import { deleteRun, loadAllRuns, saveRun } from "./persist.js";
import type { CreateRunInput, LaneState, Platform, RunEvent, RunState } from "./types.js";

type Subscriber = (event: RunEvent) => void;

/**
 * Run store with a per-run event log, fan-out to SSE subscribers, and a
 * debounced JSON snapshot on disk (see persist.ts) so a `tsx watch` reload or
 * a real restart does not orphan run history. The live event log and
 * subscriber fan-out are still in-memory only - only the run's current
 * snapshot survives a restart, not a mid-flight SSE replay buffer, which is
 * the right tradeoff for a single-node tool.
 */
class RunStore {
  #runs = new Map<string, RunState>();
  #log = new Map<string, RunEvent[]>();
  #subscribers = new Map<string, Set<Subscriber>>();
  #saveTimers = new Map<string, NodeJS.Timeout>();

  /** Load persisted runs before the server starts accepting requests. */
  async hydrate(): Promise<void> {
    for (const run of await loadAllRuns()) {
      this.#runs.set(run.id, run);
      this.#log.set(run.id, []);
    }
    this.#evict();
  }

  /** Newest-first, capped so a long-lived dev server does not grow unbounded. */
  static readonly MAX_RUNS = 50;
  static readonly MAX_SCREENSHOTS_PER_LANE = 30;

  create(input: CreateRunInput): RunState {
    const id = randomUUID();
    const lanes: Record<string, LaneState> = {};
    for (const platform of input.platforms) {
      lanes[platform] = {
        platform,
        status: "queued",
        phase: "queued",
        steps: [],
        screenshots: [],
        verifyLog: [],
        toolCallCount: 0,
      };
    }

    const run: RunState = {
      id,
      prompt: input.prompt,
      target: input.target,
      headless: input.headless ?? false,
      stabilityRuns: input.stabilityRuns ?? 0,
      createdAt: Date.now(),
      lanes,
      order: input.platforms,
    };

    this.#runs.set(id, run);
    this.#log.set(id, []);
    this.#evict();
    return run;
  }

  get(id: string): RunState | undefined {
    return this.#runs.get(id);
  }

  list(): RunState[] {
    return [...this.#runs.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  lane(runId: string, platform: Platform): LaneState | undefined {
    return this.#runs.get(runId)?.lanes[platform];
  }

  /** Replay for a client that subscribes after the run started. */
  history(runId: string): RunEvent[] {
    return this.#log.get(runId) ?? [];
  }

  subscribe(runId: string, fn: Subscriber): () => void {
    let set = this.#subscribers.get(runId);
    if (!set) {
      set = new Set();
      this.#subscribers.set(runId, set);
    }
    set.add(fn);
    return () => {
      set.delete(fn);
      if (set.size === 0) this.#subscribers.delete(runId);
    };
  }

  /**
   * Apply an event to run state, append it to the log, and fan it out.
   * State mutation and broadcast are deliberately in one place so a subscriber
   * can never observe an event that has not yet been folded into the snapshot.
   */
  emit(runId: string, event: RunEvent): void {
    const run = this.#runs.get(runId);
    if (!run) return;

    this.#apply(run, event);

    const log = this.#log.get(runId);
    // Screenshots are big; the snapshot already carries them, so keep them out
    // of the replay log to stop late subscribers pulling megabytes of base64.
    if (log && event.type !== "screenshot") log.push(event);

    for (const fn of this.#subscribers.get(runId) ?? []) {
      try {
        fn(event);
      } catch {
        // A broken pipe on one SSE client must not abort the run.
      }
    }

    this.#scheduleSave(run);
  }

  /**
   * Debounced so a burst of tool-call/screenshot events during exploration
   * collapses into one disk write instead of one per event.
   */
  #scheduleSave(run: RunState): void {
    const existing = this.#saveTimers.get(run.id);
    if (existing) clearTimeout(existing);
    this.#saveTimers.set(
      run.id,
      setTimeout(() => {
        this.#saveTimers.delete(run.id);
        void saveRun(run);
      }, 250),
    );
  }

  #apply(run: RunState, event: RunEvent): void {
    if (event.type === "run.done") {
      run.finishedAt = Date.now();
      return;
    }
    if (!("platform" in event) || !event.platform) return;
    const lane = run.lanes[event.platform];
    if (!lane) return;

    switch (event.type) {
      case "lane.phase":
        lane.phase = event.phase;
        if (event.phase === "preflight" && !lane.startedAt) lane.startedAt = Date.now();
        break;
      case "lane.status":
        lane.status = event.status;
        if (event.detail) lane.detail = event.detail;
        if (["passed", "failed", "skipped", "error"].includes(event.status)) {
          lane.finishedAt = Date.now();
        }
        break;
      case "agent.tool":
        lane.steps.push(event.step);
        lane.toolCallCount += 1;
        break;
      case "agent.tool_result": {
        const step = lane.steps.find((s) => s.id === event.id);
        if (step) {
          step.ok = event.ok;
          step.summary = event.summary;
        }
        break;
      }
      case "screenshot":
        lane.screenshots.push(event.shot);
        if (lane.screenshots.length > RunStore.MAX_SCREENSHOTS_PER_LANE) {
          lane.screenshots.splice(0, lane.screenshots.length - RunStore.MAX_SCREENSHOTS_PER_LANE);
        }
        break;
      case "artifact":
        if (event.kind === "recorded") lane.recordedCode = event.code;
        else {
          // Only a genuine content change counts as "the repair pass rewrote
          // this" - the final re-emit (same code, now with a path attached)
          // must not overwrite the diff baseline with itself.
          if (lane.specCode && lane.specCode !== event.code) lane.previousSpecCode = lane.specCode;
          lane.specCode = event.code;
          lane.specPath = event.path;
        }
        break;
      case "verify.log":
        lane.verifyLog.push(event.line);
        if (lane.verifyLog.length > 2000) lane.verifyLog.splice(0, lane.verifyLog.length - 2000);
        break;
      default:
        break;
    }
  }

  #evict(): void {
    const runs = this.list();
    for (const stale of runs.slice(RunStore.MAX_RUNS)) {
      this.#runs.delete(stale.id);
      this.#log.delete(stale.id);
      void deleteRun(stale.id);
    }
  }
}

export const store = new RunStore();
