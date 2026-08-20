import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import type { BatchState, RunState } from "./types.js";

/**
 * Flat-file persistence: one JSON snapshot per run under artifacts/<id>/run.json.
 *
 * No database, on purpose - this is a single-node dev tool (see store.ts), and
 * a run's own artifact folder already exists for the spec and failure captures.
 * Piggybacking the run snapshot there means one place to clean up, not two.
 */
const RUN_FILE = "run.json";

export async function saveRun(run: RunState): Promise<void> {
  const dir = path.join(config.artifactDir, run.id);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, RUN_FILE), JSON.stringify(run), "utf8");
}

export async function deleteRun(runId: string): Promise<void> {
  await fs.rm(path.join(config.artifactDir, runId, RUN_FILE), { force: true });
}

/** Loaded once at startup so a restart (or a `tsx watch` reload) doesn't orphan history. */
export async function loadAllRuns(): Promise<RunState[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(config.artifactDir);
  } catch {
    return [];
  }

  const runs: RunState[] = [];
  for (const id of entries) {
    try {
      const raw = await fs.readFile(path.join(config.artifactDir, id, RUN_FILE), "utf8");
      const run = JSON.parse(raw) as RunState;
      if (run && typeof run.id === "string") runs.push(run);
    } catch {
      // No run.json in this folder (an old artifact dir from before persistence
      // existed, or a partially-written one) - skip it, don't fail startup over it.
    }
  }
  return runs.sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Batches are thin (an id and a list of run ids), so they get their own flat
 * directory rather than piggybacking on a run's artifact folder the way a
 * single run's snapshot does.
 */
const BATCH_DIR = "_batches";

export async function saveBatch(batch: BatchState): Promise<void> {
  const dir = path.join(config.artifactDir, BATCH_DIR);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${batch.id}.json`), JSON.stringify(batch), "utf8");
}

export async function loadAllBatches(): Promise<BatchState[]> {
  const dir = path.join(config.artifactDir, BATCH_DIR);
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }

  const batches: BatchState[] = [];
  for (const file of entries) {
    if (!file.endsWith(".json")) continue;
    try {
      const raw = await fs.readFile(path.join(dir, file), "utf8");
      const batch = JSON.parse(raw) as BatchState;
      if (batch && typeof batch.id === "string") batches.push(batch);
    } catch {
      // Skip a partially-written or corrupt file rather than fail startup.
    }
  }
  return batches.sort((a, b) => b.createdAt - a.createdAt);
}
