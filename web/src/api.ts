import type {
  BatchCase,
  BatchState,
  BatchSummary,
  Platform,
  RunEvent,
  RunState,
  RunSummary,
  RunTarget,
  ServerCapabilities,
} from "./types";

export interface CreateRunBody {
  prompt: string;
  platforms: Platform[];
  headless: boolean;
  target: RunTarget;
  stabilityRuns?: number;
}

export class ApiError extends Error {
  readonly issues: Array<{ path: string; message: string }>;
  constructor(message: string, issues: Array<{ path: string; message: string }> = []) {
    super(message);
    this.name = "ApiError";
    this.issues = issues;
  }
}

async function parse<T>(res: Response): Promise<T> {
  if (res.ok) return (await res.json()) as T;

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new ApiError(`Request failed (${res.status} ${res.statusText}).`);
  }

  const detail = body as { error?: string; issues?: Array<{ path: string; message: string }> };
  // Field-level issues are the useful part — surface them next to the inputs
  // rather than collapsing everything into one toast.
  if (detail.issues?.length) {
    throw new ApiError("Some details need fixing before this can run.", detail.issues);
  }
  throw new ApiError(detail.error ?? `Request failed (${res.status}).`);
}

export async function fetchCapabilities(): Promise<ServerCapabilities> {
  return parse<ServerCapabilities>(await fetch("/api/capabilities"));
}

export async function createRun(body: CreateRunBody): Promise<{ id: string; run: RunState }> {
  const res = await fetch("/api/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return parse<{ id: string; run: RunState }>(res);
}

export async function cancelRun(id: string): Promise<void> {
  await fetch(`/api/runs/${id}/cancel`, { method: "POST" });
}

/** Replay an already-generated spec against the site as it is right now. */
export async function reverifyLane(id: string, platform: Platform): Promise<void> {
  const res = await fetch(`/api/runs/${id}/${platform}/reverify`, { method: "POST" });
  if (!res.ok) throw new ApiError(`Could not start the regression check (${res.status}).`);
}

export function specDownloadUrl(runId: string, platform: Platform): string {
  return `/api/runs/${runId}/${platform}/spec`;
}

export function projectDownloadUrl(runId: string, platform: Platform): string {
  return `/api/runs/${runId}/${platform}/export`;
}

export async function fetchRunHistory(): Promise<RunSummary[]> {
  const { runs } = await parse<{ runs: RunSummary[] }>(await fetch("/api/runs"));
  return runs;
}

export async function fetchRun(id: string): Promise<RunState> {
  const { run } = await parse<{ run: RunState }>(await fetch(`/api/runs/${id}`));
  return run;
}

export interface CreateBatchBody {
  cases: BatchCase[];
  platforms: Platform[];
  headless: boolean;
  stabilityRuns?: number;
}

export async function createBatch(body: CreateBatchBody): Promise<{ id: string; batch: BatchState }> {
  const res = await fetch("/api/batches", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return parse<{ id: string; batch: BatchState }>(res);
}

export async function fetchBatchList(): Promise<BatchSummary[]> {
  const { batches } = await parse<{ batches: BatchSummary[] }>(await fetch("/api/batches"));
  return batches;
}

export async function fetchBatch(id: string): Promise<{ batch: BatchState; runs: RunSummary[] }> {
  return parse<{ batch: BatchState; runs: RunSummary[] }>(await fetch(`/api/batches/${id}`));
}

/**
 * Subscribe to a run's event stream.
 *
 * EventSource reconnects on its own, and the server replays a snapshot plus the
 * event log on every connect — so a dropped connection self-heals without the
 * client tracking cursors.
 */
export function streamRun(
  runId: string,
  handlers: { onEvent: (event: RunEvent) => void; onError: (message: string) => void },
): () => void {
  const source = new EventSource(`/api/runs/${runId}/stream`);

  source.onmessage = (message) => {
    try {
      handlers.onEvent(JSON.parse(message.data) as RunEvent);
    } catch {
      // A malformed frame is not worth tearing the stream down for.
    }
  };

  source.onerror = () => {
    // readyState CLOSED means the server ended the stream (run finished) —
    // that is a normal close, not a failure worth showing the user.
    if (source.readyState === EventSource.CLOSED) return;
    handlers.onError("Lost connection to the run stream. Retrying…");
  };

  return () => source.close();
}
