import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";

/**
 * The onboarding registry: which client ids exist, and which of them have a
 * repo linked. Deliberately separate from any one client's own `.testlab/`
 * (in `project.ts`) — that directory lives *inside* a client's project and
 * travels with it; this one is cross-client tool state and has no business
 * being inside a folder a client might eventually own outright.
 */

export interface RepoLink {
  url: string;
  /** The client's real default branch — what the update branch forks from. */
  baseBranch: string;
  /**
   * Name of an env var on *this server* holding the access token — never the
   * token itself. Mirrors how `TESTLAB_SECRET_*` app credentials already work
   * here: read from the environment at use time, never written to disk.
   */
  tokenEnvVar: string;
  /**
   * Hold every change for a human to approve before it is pushed.
   *
   * Defaults to on wherever it is absent (see `requiresReview`): a run passing
   * is evidence the spec works, not evidence the team wants it. A client that
   * deliberately wants continuous push can turn this off.
   */
  requireReview?: boolean;
  linkedAt: number;
  lastSyncedAt?: number;
  /** Cleared on the next successful sync; kept between failures so the UI has something to show. */
  lastSyncError?: string;
}

export interface ClientRecord {
  id: string;
  name: string;
  createdAt: number;
  repo?: RepoLink;
}

interface ClientsFile {
  version: 1;
  clients: ClientRecord[];
}

// Every function below takes an optional `baseDir`, defaulting to the real
// repo root - the one seam tests use to point the registry at a throwaway
// directory instead of this checkout's own `.testlab/clients.json`.

function registryPath(baseDir: string): string {
  return path.join(baseDir, ".testlab", "clients.json");
}

async function readRegistry(baseDir: string): Promise<ClientsFile> {
  try {
    return JSON.parse(await fs.readFile(registryPath(baseDir), "utf8")) as ClientsFile;
  } catch {
    // Missing is the normal first-run state, and a corrupt file must not take
    // the whole registry down — same stance project.ts takes on catalog.json.
    return { version: 1, clients: [] };
  }
}

async function writeRegistry(file: ClientsFile, baseDir: string): Promise<void> {
  const target = registryPath(baseDir);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  await fs.rename(temp, target);
}

export async function listClients(baseDir: string = config.repoRoot): Promise<ClientRecord[]> {
  return (await readRegistry(baseDir)).clients;
}

export async function getClient(id: string, baseDir: string = config.repoRoot): Promise<ClientRecord | null> {
  return (await readRegistry(baseDir)).clients.find((c) => c.id === id) ?? null;
}

/**
 * Registers a client, or renames one that already exists.
 *
 * A client id that was already in use before it was ever onboarded here (the
 * free-text `clientId` field on a run predates this registry) is adopted on
 * first onboarding rather than rejected or duplicated — the registry is a
 * record of what's known about a client id, not the sole authority on
 * whether that id is allowed to exist.
 */
export async function upsertClient(id: string, name: string, baseDir: string = config.repoRoot): Promise<ClientRecord> {
  const file = await readRegistry(baseDir);
  const existing = file.clients.find((c) => c.id === id);
  if (existing) {
    existing.name = name;
    await writeRegistry(file, baseDir);
    return existing;
  }
  const record: ClientRecord = { id, name, createdAt: Date.now() };
  file.clients.push(record);
  await writeRegistry(file, baseDir);
  return record;
}

export async function linkClientRepo(
  id: string,
  repo: Omit<RepoLink, "linkedAt">,
  baseDir: string = config.repoRoot,
): Promise<ClientRecord> {
  const file = await readRegistry(baseDir);
  const client = file.clients.find((c) => c.id === id);
  if (!client) throw new Error(`No client registered with id "${id}".`);
  client.repo = { ...repo, linkedAt: Date.now() };
  await writeRegistry(file, baseDir);
  return client;
}

/**
 * Whether this repo's changes need approving before they are pushed.
 *
 * Absent means yes. The field was added after clients had already been
 * linked, and defaulting an unset flag to "push without asking" would silently
 * remove the gate from exactly the repos that predate it.
 */
export function requiresReview(repo: RepoLink): boolean {
  return repo.requireReview !== false;
}

export async function recordSyncResult(
  id: string,
  result: { ok: boolean; reason?: string },
  baseDir: string = config.repoRoot,
): Promise<void> {
  const file = await readRegistry(baseDir);
  const client = file.clients.find((c) => c.id === id);
  if (!client?.repo) return; // Unlinked since the sync was kicked off - nothing to record.
  client.repo.lastSyncedAt = Date.now();
  client.repo.lastSyncError = result.ok ? undefined : result.reason;
  await writeRegistry(file, baseDir);
}
