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

export interface LaneState {
  platform: Platform;
  status: LaneStatus;
  phase: Phase;
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
