import type { ReuseMode } from "./knowledge/types.js";

/**
 * What a passing run contributed to the client's project.
 *
 * Structural mirror of the knowledge layer's SaveReport, declared here because
 * it crosses the wire to the browser; keeping the event contract in one file
 * is what stops the UI and the server drifting apart.
 */
export interface SaveSummary {
  specFile: string;
  pages: Array<{
    className: string;
    created: boolean;
    addedElements: string[];
    addedMethods: string[];
    changedLocators: Array<{ property: string; from: string; to: string }>;
    /** Credential methods on an existing page that predate element-level masking. */
    unmaskedMethods: string[];
  }>;
  locatorsAdded: string[];
  locatorsChanged: string[];
  reusedExistingSpec: boolean;
  /** Landed as a new it() inside an already-saved spec, rather than its own file. */
  addedToExistingSpec: boolean;
  /** Calls page-object methods rather than raw selectors. */
  usesPageObjects: boolean;
  /**
   * What happened to the business-function layer: flows written, existing ones
   * reused, or an extraction rolled back because the lifted spec did not
   * replay. See knowledge/businessFunction.ts.
   */
  flow?: {
    names: string[];
    applied: boolean;
    /** Those that already existed; nothing new was written for them. */
    reused?: string[];
    /** The lifted spec was replayed and passed. */
    verified?: boolean;
    /** New flows that delegate their opening steps to one that already existed. */
    composedFrom?: Array<{ name: string; steps: number }>;
    reason?: string;
  };
  /**
   * A run of opening steps this scenario shares with an earlier spec, surfaced
   * only when nothing was done about it automatically.
   */
  flowSuggestion?: { steps: number; sharedWithFile: string; sharedWithTitle: string };
  /**
   * Whether this run's changes reached the client's linked repo, if they have
   * one. `awaitingReview` is the normal outcome: the change is committed
   * locally and waiting for a person to approve it before it is pushed.
   */
  repoSync?: { pushed: boolean; branch: string; error?: string; awaitingReview?: string };
}

export const PLATFORMS = ["web", "android", "ios"] as const;
export type Platform = (typeof PLATFORMS)[number];

export function isPlatform(v: unknown): v is Platform {
  return typeof v === "string" && (PLATFORMS as readonly string[]).includes(v);
}

/**
 * A lane moves strictly forward through these. `explore` drives the real
 * device; `verify` replays the generated spec in a fresh process, which is
 * what makes a green result mean "this artifact is reusable" rather than
 * "the agent managed to click through it once".
 */
export const PHASES = ["queued", "preflight", "explore", "export", "synthesize", "verify", "done"] as const;
export type Phase = (typeof PHASES)[number];

export type LaneStatus = "queued" | "running" | "passed" | "failed" | "skipped" | "error";

/** What the test runs against. Supplied per run — nothing is hardcoded. */
export interface RunTarget {
  /** Web lane: the URL under test. */
  webUrl?: string;
  /** Android lane: absolute path to a local .apk, or a cloud app id. */
  androidApp?: string;
  /** iOS lane: a cloud app id (bs://… / storage:filename=…). Local iOS needs macOS. */
  iosApp?: string;
  /** iOS lane: device to request from the farm. */
  iosDeviceName?: string;
  iosPlatformVersion?: string;
}

export interface CreateRunInput {
  prompt: string;
  platforms: Platform[];
  target: RunTarget;
  headless?: boolean;
  /**
   * Which client this run belongs to. Runs are namespaced by it on disk so two
   * clients' artifacts can never collide and each has its own audit trail.
   */
  clientId?: string;
  /**
   * Login details and other per-request secrets, by name (USERNAME, PASSWORD…).
   *
   * Deliberately NOT part of RunState: that whole object is streamed to the
   * browser in `run.snapshot`. Values live only in the secret vault, keyed by
   * run id, and reach the device through placeholder substitution.
   */
  secrets?: Record<string, string>;
  /** Extra cold `wdio run` repeats after the first pass, to catch flaky specs. */
  stabilityRuns?: number;
}

/** Just the two numbers every provider's billing actually keys off - deliberately not coupled to the LLM adapter's own copy of this shape. */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface LaneState {
  platform: Platform;
  status: LaneStatus;
  phase: Phase;
  /** Human-readable reason for a skip/error, shown verbatim in the UI. */
  detail?: string;
  steps: AgentStep[];
  screenshots: Screenshot[];
  recordedCode?: string;
  specCode?: string;
  previousSpecCode?: string;
  specPath?: string;
  verifyLog: string[];
  startedAt?: number;
  finishedAt?: number;
  toolCallCount: number;
  /** How the request was satisfied, and why — shown, not just logged. */
  reuse?: { mode: ReuseMode; reason: string };
  /** What this lane contributed to the client's project. */
  saved?: SaveSummary;
  /** Running total across every LLM call this lane has made so far - explore, structure, code, lint-fix, repair, failure summary. */
  usage: TokenUsage;
  /** The same total, split by which provider actually served each call - keyed by provider id ("custom", "gemini", ...). Absent/partial on runs from before this was tracked. */
  usageByProvider: Record<string, TokenUsage>;
}

export interface AgentStep {
  id: string;
  name: string;
  input: unknown;
  ok?: boolean;
  summary?: string;
  at: number;
}

export interface Screenshot {
  id: string;
  /** data: URI, already size-capped by @wdio/mcp. */
  dataUrl: string;
  at: number;
  caption?: string;
}

export interface RunState {
  id: string;
  clientId: string;
  prompt: string;
  target: RunTarget;
  headless: boolean;
  stabilityRuns: number;
  createdAt: number;
  finishedAt?: number;
  lanes: Record<string, LaneState>;
  order: Platform[];
  /** Secret NAMES only — never values. Lets the UI show what was injected. */
  secretNames: string[];
}

/** One row of a bulk upload: its own scenario and target, sharing the batch's platform/headless/stability settings. */
export interface BatchCase {
  prompt: string;
  target: RunTarget;
}

/**
 * A batch is a thin ordered pointer to real runs, not a parallel execution
 * model. Cases run one at a time through the exact same pipeline a single
 * submission uses — sequential on purpose, since three lanes already contend
 * for one rate-limited key; N cases run in parallel would multiply that.
 */
export interface BatchState {
  id: string;
  createdAt: number;
  finishedAt?: number;
  platforms: Platform[];
  headless: boolean;
  stabilityRuns: number;
  /** Populated as each case starts - the last id is still running until finishedAt is set. */
  runIds: string[];
  /** Total cases requested, known immediately even before every run has been created. */
  caseCount: number;
}

export type RunEvent =
  | { type: "run.snapshot"; run: RunState }
  | { type: "lane.phase"; platform: Platform; phase: Phase }
  | { type: "lane.status"; platform: Platform; status: LaneStatus; detail?: string }
  | { type: "agent.text"; platform: Platform; text: string }
  | { type: "agent.tool"; platform: Platform; step: AgentStep }
  | { type: "agent.tool_result"; platform: Platform; id: string; ok: boolean; summary: string }
  | { type: "screenshot"; platform: Platform; shot: Screenshot }
  | { type: "artifact"; platform: Platform; kind: "recorded" | "spec"; code: string; path?: string }
  | { type: "verify.log"; platform: Platform; line: string }
  /** How much work this lane needed, decided before any of it started. */
  | { type: "lane.reuse"; platform: Platform; mode: ReuseMode; reason: string }
  /** What the run added to the client's project. */
  | { type: "lane.saved"; platform: Platform; report: SaveSummary }
  /** A delta to add to the lane's running total, not the total itself - emitted once per LLM call site (explore, structure, code, repair, ...). */
  | { type: "lane.usage"; platform: Platform; usage: TokenUsage }
  /** Same delta, tagged with which provider actually served it - independent of lane.usage above, so the two are additive and never need reconciling. */
  | { type: "lane.provider_usage"; platform: Platform; provider: string; usage: TokenUsage }
  | { type: "run.done"; runId: string }
  | { type: "error"; platform?: Platform; message: string };
