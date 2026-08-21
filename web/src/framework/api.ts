import type { FrameworkState, PlanResult } from "./types";

async function json<T>(res: Response): Promise<T> {
  if (res.ok) return (await res.json()) as T;
  let message = `Request failed (${res.status}).`;
  try {
    const body = (await res.json()) as { error?: string };
    if (body.error) message = body.error;
  } catch {
    /* keep the status-based message */
  }
  throw new Error(message);
}

export async function getFramework(): Promise<FrameworkState> {
  return json<FrameworkState>(await fetch("/api/framework"));
}

export async function openFramework(path: string): Promise<FrameworkState> {
  return json<FrameworkState>(
    await fetch("/api/framework/open", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path }),
    }),
  );
}

export async function refreshFramework(): Promise<FrameworkState> {
  return json<FrameworkState>(await fetch("/api/framework/refresh", { method: "POST" }));
}

export async function planTest(prompt: string, platform: "web" | "mobile"): Promise<PlanResult> {
  return json<PlanResult>(
    await fetch("/api/framework/plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt, platform }),
    }),
  );
}

export interface TypecheckResult {
  status: "passed" | "failed" | "skipped";
  reason?: string;
  diagnostics: Array<{ line: number; column: number; message: string; code: number; inCandidate: boolean }>;
}

export async function verifyPlan(planId: string): Promise<TypecheckResult> {
  return json<TypecheckResult>(
    await fetch("/api/framework/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ planId }),
    }),
  );
}

export async function applyPlan(planId: string): Promise<{ written: string[] }> {
  return json<{ written: string[] }>(
    await fetch("/api/framework/apply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ planId }),
    }),
  );
}
