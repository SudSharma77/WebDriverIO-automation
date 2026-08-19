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
  specPath?: string;
  verifyLog: string[];
  startedAt?: number;
  finishedAt?: number;
  toolCallCount: number;
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
  createdAt: number;
  finishedAt?: number;
  lanes: Record<string, LaneState>;
  order: Platform[];
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
  | { type: "run.done"; runId: string }
  | { type: "error"; platform?: Platform; message: string };
