import path from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import { indexFramework, resolveFrameworkRoot } from "./indexer.js";
import type { FrameworkIndex } from "./types.js";
import type { ProposedDiff } from "../planner/types.js";

/**
 * Holds the framework currently being worked on, plus the diffs proposed
 * against it.
 *
 * Indexing walks and parses the whole project, so it is cached and refreshed
 * explicitly rather than on every request. Proposed diffs are kept server-side
 * so that applying one does not mean re-running the planner — and therefore
 * cannot silently apply something different from what the user reviewed.
 */
class FrameworkStore {
  #index: FrameworkIndex | null = null;
  #diffs = new Map<string, ProposedDiff>();

  static readonly MAX_DIFFS = 20;

  get current(): FrameworkIndex | null {
    return this.#index;
  }

  /** Resolve a user-supplied path against sensible bases, then index it. */
  async open(input: string): Promise<FrameworkIndex> {
    const root = await resolveFrameworkRoot(input, [config.repoRoot, process.cwd(), config.serverRoot]);
    this.#index = await indexFramework(root);
    this.#diffs.clear();
    return this.#index;
  }

  /** Re-read from disk — the user has probably just edited the framework. */
  async refresh(): Promise<FrameworkIndex> {
    if (!this.#index) throw new Error("No framework is open.");
    this.#index = await indexFramework(this.#index.root);
    return this.#index;
  }

  /** Open whatever FRAMEWORK_ROOT points at, if anything. Never throws. */
  async openDefault(): Promise<FrameworkIndex | null> {
    if (!config.FRAMEWORK_ROOT) return null;
    try {
      return await this.open(config.FRAMEWORK_ROOT);
    } catch {
      return null;
    }
  }

  rememberDiff(diff: ProposedDiff): string {
    const id = randomUUID();
    this.#diffs.set(id, diff);
    for (const stale of [...this.#diffs.keys()].slice(0, Math.max(0, this.#diffs.size - FrameworkStore.MAX_DIFFS))) {
      this.#diffs.delete(stale);
    }
    return id;
  }

  takeDiff(id: string): ProposedDiff | undefined {
    return this.#diffs.get(id);
  }
}

export const frameworks = new FrameworkStore();

/** Repo-relative path, for display. */
export function displayPath(index: FrameworkIndex): string {
  const relative = path.relative(config.repoRoot, index.root);
  return relative && !relative.startsWith("..") ? relative : index.root;
}
