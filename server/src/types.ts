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
  /** Running total across every LLM call this lane has made so far - explore, structure, code, lint-fix, repair, failure summary. */
  usage: TokenUsage;
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
  prompt: string;
  target: RunTarget;
  headless: boolean;
  stabilityRuns: number;
  createdAt: number;
  finishedAt?: number;
  lanes: Record<string, LaneState>;
  order: Platform[];
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
  /** A delta to add to the lane's running total, not the total itself - emitted once per LLM call site (explore, structure, code, repair, ...). */
  | { type: "lane.usage"; platform: Platform; usage: TokenUsage }
  | { type: "run.done"; runId: string }
  | { type: "error"; platform?: Platform; message: string };
