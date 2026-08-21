import { randomUUID } from "node:crypto";
import { startRun } from "./orchestrator.js";
import { loadAllBatches, saveBatch } from "./persist.js";
import { store } from "./store.js";
import type { BatchCase, BatchState, Platform } from "./types.js";

export interface CreateBatchInput {
  cases: BatchCase[];
  platforms: Platform[];
  headless: boolean;
  stabilityRuns: number;
}

/**
 * Runs a bulk upload of test cases one at a time through the same pipeline a
 * single submission uses - each case becomes a real, independent run (own
 * history entry, own spec, own artifacts). Sequential by design: three lanes
 * already contend for one LLM key tonight, running N cases in parallel would
 * only make that worse.
 */
class BatchStore {
  #batches = new Map<string, BatchState>();

  async hydrate(): Promise<void> {
    for (const batch of await loadAllBatches()) {
      this.#batches.set(batch.id, batch);
    }
  }

  create(input: CreateBatchInput): BatchState {
    const batch: BatchState = {
      id: randomUUID(),
      createdAt: Date.now(),
      platforms: input.platforms,
      headless: input.headless,
      stabilityRuns: input.stabilityRuns,
      runIds: [],
      caseCount: input.cases.length,
    };
    this.#batches.set(batch.id, batch);
    void saveBatch(batch);

    void (async () => {
      for (const c of input.cases) {
        const run = startRun({
          prompt: c.prompt,
          platforms: input.platforms,
          target: c.target,
          headless: input.headless,
          stabilityRuns: input.stabilityRuns,
        });
        batch.runIds.push(run.id);
        void saveBatch(batch);
        await waitForRun(run.id);
      }
      batch.finishedAt = Date.now();
      void saveBatch(batch);
    })();

    return batch;
  }

  get(id: string): BatchState | undefined {
    return this.#batches.get(id);
  }

  list(): BatchState[] {
    return [...this.#batches.values()].sort((a, b) => b.createdAt - a.createdAt);
  }
}

function waitForRun(runId: string): Promise<void> {
  const run = store.get(runId);
  if (run?.finishedAt) return Promise.resolve();

  return new Promise((resolve) => {
    const unsubscribe = store.subscribe(runId, (event) => {
      if (event.type === "run.done") {
        unsubscribe();
        resolve();
      }
    });
  });
}

export const batchStore = new BatchStore();
