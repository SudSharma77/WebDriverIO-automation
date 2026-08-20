/**
 * Mirror of the server's wire types.
 *
 * Deliberately duplicated rather than extracted into a shared workspace: the
 * surface is small and stable, and keeping it here lets the web app build with
 * its own bundler tsconfig instead of dragging in the server's NodeNext setup.
 * If this grows past a screenful, promote it to a `shared/` workspace.
 */

export const PLATFORMS = ["web", "android", "ios"] as const;
export type Platform = (typeof PLATFORMS)[number];

export const PHASES = ["queued", "preflight", "explore", "export", "synthesize", "verify", "done"] as const;
export type Phase = (typeof PHASES)[number];

/** Rendered on the phase rail — `queued` and `done` are endpoints, not steps. */
export const RAIL_PHASES: Phase[] = ["preflight", "explore", "export", "synthesize", "verify"];

export type LaneStatus = "queued" | "running" | "passed" | "failed" | "skipped" | "error";

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
  dataUrl: string;
  at: number;
  caption?: string;
}

/** Just the two numbers every provider's billing actually keys off. */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface LaneState {
  platform: Platform;
  status: LaneStatus;
  phase: Phase;
  detail?: string;
  steps: AgentStep[];
  screenshots: Screenshot[];
  recordedCode?: string;
  specCode?: string;
  /** The spec code as it was just before the most recent overwrite - powers the repair diff view. */
  previousSpecCode?: string;
  specPath?: string;
  verifyLog: string[];
  startedAt?: number;
  finishedAt?: number;
  toolCallCount: number;
  /** Running total across every LLM call this lane has made so far. */
  usage: TokenUsage;
  /** Client-side only: the agent's running narration. */
  narration?: string[];
}

export interface RunTarget {
  webUrl?: string;
  androidApp?: string;
  iosApp?: string;
  iosDeviceName?: string;
  iosPlatformVersion?: string;
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

/** Summary row for the run-history list — GET /api/runs. */
export interface RunSummary {
  id: string;
  prompt: string;
  createdAt: number;
  finishedAt?: number;
  platforms: Platform[];
  statuses: Record<string, LaneStatus>;
  /** Only present from GET /api/batches/:id — a plain-English failure cause per platform, when failed. */
  details?: Record<string, string | undefined>;
}

/** One row of a bulk upload: its own scenario and target. */
export interface BatchCase {
  prompt: string;
  target: RunTarget;
}

export interface BatchState {
  id: string;
  createdAt: number;
  finishedAt?: number;
  platforms: Platform[];
  headless: boolean;
  stabilityRuns: number;
  runIds: string[];
  caseCount: number;
}

/** Summary row for the batch-history list — GET /api/batches. */
export interface BatchSummary {
  id: string;
  createdAt: number;
  finishedAt?: number;
  platforms: Platform[];
  caseCount: number;
  completed: number;
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
  /** A delta to add to the lane's running total, not the total itself. */
  | { type: "lane.usage"; platform: Platform; usage: TokenUsage }
  | { type: "run.done"; runId: string }
  | { type: "error"; platform?: Platform; message: string };

export interface ServerCapabilities {
  platforms: Platform[];
  cloudProvider: string | null;
  iosAvailable: boolean;
  appiumUrl: string;
  maxAgentSteps: number;
  host: string;
  llm: {
    provider: string;
    model: string;
    sendsScreenshots: boolean;
    leanTools: boolean;
  };
}

export const PLATFORM_LABEL: Record<Platform, string> = {
  web: "Web",
  android: "Android",
  ios: "iOS",
};

export const PLATFORM_GLYPH: Record<Platform, string> = {
  web: "◍",
  android: "▲",
  ios: "▮",
};
