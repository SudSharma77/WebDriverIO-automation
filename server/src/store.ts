import { randomUUID } from "node:crypto";
import { SecretBag } from "./lanes/secrets.js";
import { deleteRun, loadAllRuns, saveRun } from "./persist.js";
import type { CreateRunInput, LaneState, Platform, RunEvent, RunState, RunTarget } from "./types.js";

type Subscriber = (event: RunEvent) => void;

/**
 * Run store with a per-run event log, fan-out to SSE subscribers, and a
 * debounced JSON snapshot on disk (see persist.ts) so a `tsx watch` reload or
 * a real restart does not orphan run history. The live event log and
 * subscriber fan-out are still in-memory only - only the run's current
 * snapshot survives a restart, not a mid-flight SSE replay buffer, which is
 * the right tradeoff for a single-node tool.
 */
export class RunStore {
  /**
   * Whether this store writes to disk.
   *
   * Off for the instance tests use. A test that exercises the real singleton
   * writes run.json files into the user's artifact directory and its fixtures
   * then show up in their run history — which is exactly what happened before
   * this existed.
   */
  readonly #persistent: boolean;

  constructor(options: { persistent?: boolean } = {}) {
    this.#persistent = options.persistent ?? true;
  }

  #runs = new Map<string, RunState>();
  #log = new Map<string, RunEvent[]>();
  #subscribers = new Map<string, Set<Subscriber>>();
  /**
   * Credentials, held beside RunState rather than on it.
   *
   * RunState is serialised wholesale into `run.snapshot` and sent to every SSE
   * subscriber, and is now also persisted to disk — so anything stored on it is
   * effectively public. Keeping the bag in a parallel map makes that leak
   * impossible by construction instead of by remembering to strip a field.
   */
  #secrets = new Map<string, SecretBag>();
  #saveTimers = new Map<string, NodeJS.Timeout>();

  /** Load persisted runs before the server starts accepting requests. */
  async hydrate(): Promise<void> {
    for (const run of await loadAllRuns()) {
      // A run.json written before token-usage tracking existed has no
      // `usage` field on its lanes - backfill zero so #apply's arithmetic
      // never hits undefined.
      for (const lane of Object.values(run.lanes)) {
        lane.usage ??= { inputTokens: 0, outputTokens: 0 };
        lane.usageByProvider ??= {};

        // Nothing loaded from disk can still be running: the process that owned
        // its browser session died with the last server. Left as "running" the
        // lane would spin in the UI forever and the run would be unclearable.
        if (lane.status === "running" || lane.status === "queued") {
          lane.status = "error";
          lane.detail ??= "The server restarted while this run was in flight.";
        }
      }
      run.finishedAt ??= Date.now();

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
        usage: { inputTokens: 0, outputTokens: 0 },
        usageByProvider: {},
      };
    }

    const secrets = SecretBag.from(input.secrets);

    const run: RunState = {
      id,
      clientId: input.clientId ?? "default",
      prompt: input.prompt,
      target: input.target,
      headless: input.headless ?? false,
      stabilityRuns: input.stabilityRuns ?? 0,
      createdAt: Date.now(),
      lanes,
      order: input.platforms,
      secretNames: secrets.names,
    };

    this.#runs.set(id, run);
    this.#log.set(id, []);
    this.#secrets.set(id, secrets);
    this.#evict();
    return run;
  }

  /**
   * Forget past runs.
   *
   * Deletes the in-memory state, the replay log, the credential vault and the
   * persisted run.json, so a cleared run cannot come back on the next server
   * start. A run still in flight is left alone: its lanes hold live browser
   * sessions, and removing the state they emit into would orphan them.
   *
   * The client's accumulated suite under clients/ is deliberately untouched —
   * that is the durable output, not history.
   */
  clearHistory(options: { keep?: (run: RunState) => boolean } = {}): { cleared: number; kept: number } {
    let cleared = 0;
    let kept = 0;

    for (const run of [...this.#runs.values()]) {
      if (this.#isInFlight(run) || options.keep?.(run)) {
        kept++;
        continue;
      }
      this.#forget(run.id);
      cleared++;
    }

    return { cleared, kept };
  }

  /** Forget one run. Returns false if it is unknown or still running. */
  forget(runId: string): boolean {
    const run = this.#runs.get(runId);
    if (!run || this.#isInFlight(run)) return false;
    this.#forget(runId);
    return true;
  }

  /**
   * Whether a run still has work happening.
   *
   * Deliberately not `!run.finishedAt`. A run whose lanes have all settled but
   * that never emitted run.done — because the process died, or something threw
   * outside the orchestrator's finally — would be protected from clearing
   * forever under that rule, leaving rows in the history that nothing can
   * remove. What matters is whether a lane is actually still working.
   */
  #isInFlight(run: RunState): boolean {
    if (run.finishedAt) return false;
    return Object.values(run.lanes).some((lane) => lane.status === "running" || lane.status === "queued");
  }

  #forget(runId: string): void {
    const timer = this.#saveTimers.get(runId);
    // A pending debounced save would otherwise rewrite the file we just removed.
    if (timer) {
      clearTimeout(timer);
      this.#saveTimers.delete(runId);
    }
    this.#runs.delete(runId);
    this.#log.delete(runId);
    this.#secrets.delete(runId);
    this.#subscribers.delete(runId);
    if (this.#persistent) void deleteRun(runId);
  }

  /** The run's credentials. Server-side callers only — never serialise this. */
  secrets(runId: string): SecretBag {
    return this.#secrets.get(runId) ?? SecretBag.from({});
  }

  /**
   * Drop the credentials once the run is over.
   *
   * Artifacts and logs outlive the run for the audit trail; the values that
   * produced them should not. Called from the orchestrator's finally block, so
   * it happens on cancellation and failure too, not just on success.
   */
  forgetSecrets(runId: string): void {
    this.#secrets.delete(runId);
  }

  get(id: string): RunState | undefined {
    return this.#runs.get(id);
  }

  /**
   * Newest first, deterministically.
   *
   * `createdAt` is millisecond-resolution, so two runs started in the same tick
   * tie — and the cache reads this list to decide which spec to replay, where
   * an arbitrary winner means an arbitrary test. Map iteration is insertion
   * order and Array.sort is stable, so reversing first makes insertion order
   * the tie-breaker: later-created wins.
   */
  list(): RunState[] {
    return [...this.#runs.values()].reverse().sort((a, b) => b.createdAt - a.createdAt);
  }

  lane(runId: string, platform: Platform): LaneState | undefined {
    return this.#runs.get(runId)?.lanes[platform];
  }

  /**
   * Most recent prior run with the exact same prompt + target for this
   * platform that produced a spec. The caller tries replaying that spec cold
   * before paying for a fresh explore+synthesize - free and fast when the
   * target hasn't changed, and only falls back to full generation when it
   * genuinely no longer passes.
   */
  findCachedSpec(prompt: string, platform: Platform, target: RunTarget): string | null {
    const key = fingerprint(prompt, platform, target);
    if (!key) return null;

    // list() is newest-first, so a later green run supersedes an earlier one.
    for (const run of this.list()) {
      const lane = run.lanes[platform];
      if (!lane?.specCode) continue;
      // Only a spec that actually passed is worth replaying. Caching on
      // spec-exists alone meant a failed run's spec was served back forever:
      // every repeat of that prompt spent a browser session re-proving the
      // same failure, and because the cache path calls no model, no amount of
      // prompt improvement could ever produce a better spec for it.
      if (lane.status !== "passed") continue;
      if (fingerprint(run.prompt, platform, run.target) === key) return lane.specCode;
    }
    return null;
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
    if (!this.#persistent) return;

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
      case "lane.reuse":
        lane.reuse = { mode: event.mode, reason: event.reason };
        break;
      case "lane.saved":
        lane.saved = event.report;
        break;
      case "lane.usage":
        lane.usage = {
          inputTokens: lane.usage.inputTokens + event.usage.inputTokens,
          outputTokens: lane.usage.outputTokens + event.usage.outputTokens,
        };
        break;
      case "lane.provider_usage": {
        const prior = lane.usageByProvider[event.provider] ?? { inputTokens: 0, outputTokens: 0 };
        lane.usageByProvider[event.provider] = {
          inputTokens: prior.inputTokens + event.usage.inputTokens,
          outputTokens: prior.outputTokens + event.usage.outputTokens,
        };
        break;
      }
      default:
        break;
    }
  }

  #evict(): void {
    const runs = this.list();
    for (const stale of runs.slice(RunStore.MAX_RUNS)) {
      this.#runs.delete(stale.id);
      this.#log.delete(stale.id);
      this.#secrets.delete(stale.id);
      void deleteRun(stale.id);
    }
  }
}

/**
 * Normalized enough that trivial formatting differences (extra whitespace,
 * casing, a trailing slash) don't defeat the cache, but nothing fuzzier -
 * a genuinely different prompt should genuinely re-explore, not silently
 * reuse a plausibly-similar old spec.
 */
function fingerprint(prompt: string, platform: Platform, target: RunTarget): string | null {
  const normalizedPrompt = prompt.trim().toLowerCase().replace(/\s+/g, " ");
  const targetValue =
    platform === "web"
      ? target.webUrl
      : platform === "android"
        ? target.androidApp
        : target.iosApp;
  if (!normalizedPrompt || !targetValue) return null;

  const normalizedTarget = targetValue.trim().toLowerCase().replace(/\/+$/, "");
  return `${platform}::${normalizedTarget}::${normalizedPrompt}`;
}

export const store = new RunStore();
