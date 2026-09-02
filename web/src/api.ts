import type {
  BatchCase,
  BatchState,
  BatchSummary,
  ClientRecord,
  Platform,
  RunEvent,
  RunState,
  ReviewRequest,
  RunSummary,
  RunTarget,
  ServerCapabilities,
} from "./types";

export interface CreateRunBody {
  prompt: string;
  platforms: Platform[];
  headless: boolean;
  target: RunTarget;
  /** Which client's accumulated suite this run grows. */
  clientId: string;
  /**
   * Login details, by name. Sent once to start the run and never returned:
   * the server keeps them beside the run state, not on it.
   */
  secrets: Record<string, string>;
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

/** Build on an already-passing lane with additional steps, as a new run. */
export async function extendRun(
  id: string,
  platform: Platform,
  additionalPrompt: string,
): Promise<{ id: string; run: RunState }> {
  const res = await fetch(`/api/runs/${id}/${platform}/extend`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ additionalPrompt }),
  });
  return parse<{ id: string; run: RunState }>(res);
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

/** Forget finished runs. Generated suites under clients/ are not touched. */
export async function clearRunHistory(): Promise<{ cleared: number; kept: number }> {
  return parse<{ cleared: number; kept: number }>(await fetch("/api/runs", { method: "DELETE" }));
}

export async function forgetRun(id: string): Promise<void> {
  await parse<{ cleared: number }>(await fetch(`/api/runs/${id}`, { method: "DELETE" }));
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
  clientId?: string;
  /** Applied to every case in the batch — one login, tested across many scenarios. */
  secrets?: Record<string, string>;
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
 *
 * A run that no longer exists is answered with 204, which the spec defines as
 * "do not reconnect". Without that, a tab left open on a cleared run retries
 * forever, and the reconnects surface as ECONNRESET noise in the dev proxy.
 */
export async function fetchClients(): Promise<ClientRecord[]> {
  const { clients } = await parse<{ clients: ClientRecord[] }>(await fetch("/api/clients"));
  return clients;
}

export interface LinkRepoBody {
  url: string;
  baseBranch: string;
  tokenEnvVar: string;
}

/**
 * Onboarding always produces a project on disk under `clients/<id>/`. The repo
 * is optional, and its failure is reported rather than thrown: a client whose
 * repo URL had a typo is still onboarded, and can link one from its own form.
 */
export async function onboardClient(
  id: string,
  name: string,
  repo?: LinkRepoBody,
): Promise<{ client: ClientRecord; repoError?: string }> {
  const res = await fetch("/api/clients", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, name, repo }),
  });
  return parse<{ client: ClientRecord; repoError?: string }>(res);
}

/** The server proves the URL and token work (a real `git ls-remote`) before this resolves. */
export async function linkClientRepo(id: string, body: LinkRepoBody): Promise<ClientRecord> {
  const res = await fetch(`/api/clients/${id}/repo`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const { client } = await parse<{ client: ClientRecord }>(res);
  return client;
}

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

/**
 * The queue of changes waiting on a human, newest first.
 *
 * Deliberately without diffs: a queue of twenty changes should not carry
 * twenty full diffs to the browser. `fetchReview` gets one when it is opened.
 */
export async function fetchReviews(clientId: string): Promise<ReviewRequest[]> {
  const res = await fetch(`/api/clients/${encodeURIComponent(clientId)}/reviews`);
  const { reviews } = await parse<{ reviews: ReviewRequest[] }>(res);
  return reviews;
}

export interface PendingReviews {
  total: number;
  clients: Array<{ clientId: string; clientName: string; count: number }>;
}

/** Cross-client summary, so the app can point someone at what needs review without them knowing which client to check. */
export async function fetchPendingReviews(): Promise<PendingReviews> {
  return parse<PendingReviews>(await fetch("/api/reviews/pending"));
}

export async function fetchReview(clientId: string, reviewId: string): Promise<{ review: ReviewRequest; diff: string | null }> {
  const res = await fetch(`/api/clients/${encodeURIComponent(clientId)}/reviews/${encodeURIComponent(reviewId)}`);
  return parse<{ review: ReviewRequest; diff: string | null }>(res);
}

/** Push it. The reviewer's name goes into the commit and the record. */
export async function approveReview(clientId: string, reviewId: string, reviewer: string, note?: string): Promise<ReviewRequest> {
  const res = await fetch(`/api/clients/${encodeURIComponent(clientId)}/reviews/${encodeURIComponent(reviewId)}/approve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reviewer, note }),
  });
  const { review } = await parse<{ review: ReviewRequest }>(res);
  return review;
}

/** Drop it. The change leaves the project, not just the push queue. */
export async function rejectReview(clientId: string, reviewId: string, reviewer: string, note?: string): Promise<ReviewRequest> {
  const res = await fetch(`/api/clients/${encodeURIComponent(clientId)}/reviews/${encodeURIComponent(reviewId)}/reject`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reviewer, note }),
  });
  const { review } = await parse<{ review: ReviewRequest }>(res);
  return review;
}
