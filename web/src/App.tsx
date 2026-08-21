import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ApiError,
  cancelRun,
  createBatch,
  createRun,
  extendRun,
  fetchCapabilities,
  fetchRun,
  reverifyLane,
  type CreateBatchBody,
  type CreateRunBody,
} from "./api";
import { BatchResults } from "./components/BatchResults";
import { BatchUpload } from "./components/BatchUpload";
import { Composer } from "./components/Composer";
import { History } from "./components/History";
import { LaneCard } from "./components/LaneCard";
import { Lightbox } from "./components/Lightbox";
import type { LaneStatus, ServerCapabilities } from "./types";
import { useRun } from "./useRun";

type Theme = "dark" | "light";
type Mode = "single" | "bulk";

export default function App() {
  const [capabilities, setCapabilities] = useState<ServerCapabilities | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [issues, setIssues] = useState<Array<{ path: string; message: string }>>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [zoom, setZoom] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>(() =>
    document.documentElement.dataset.theme === "light" ? "light" : "dark",
  );

  const { run, streamError, runError, watch, reset } = useRun();
  const [historyRefresh, setHistoryRefresh] = useState(0);
  const [mode, setMode] = useState<Mode>("single");
  const [batchId, setBatchId] = useState<string | null>(null);
  const [batchSubmitting, setBatchSubmitting] = useState(false);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // Refresh the history list once a run actually finishes, so it shows up
  // without the user needing to reload the page.
  useEffect(() => {
    if (run?.finishedAt) setHistoryRefresh((n) => n + 1);
  }, [run?.finishedAt]);

  const openHistoryRun = useCallback(
    async (id: string) => {
      try {
        const loaded = await fetchRun(id);
        watch(id, loaded);
      } catch {
        setSubmitError("Could not load that run — it may have been evicted from history.");
      }
    },
    [watch],
  );

  const reverify = useCallback(
    async (platform: Parameters<typeof reverifyLane>[1]) => {
      if (!run) return;
      try {
        await reverifyLane(run.id, platform);
        // Force a fresh SSE connection: the original stream closed when this
        // run first finished, and the lane is about to flip back to "running".
        watch(run.id);
      } catch (err) {
        setSubmitError(err instanceof Error ? err.message : "Could not start the regression check.");
      }
    },
    [run, watch],
  );

  useEffect(() => {
    fetchCapabilities()
      .then(setCapabilities)
      .catch(() =>
        setBootError(
          "Cannot reach the backend. Start it with `npm run dev:server` (or `npm run dev` for both).",
        ),
      );
  }, []);

  const live = useMemo(() => {
    if (!run) return false;
    if (run.finishedAt) return false;
    return Object.values(run.lanes).some((lane) => lane.status === "queued" || lane.status === "running");
  }, [run]);

  const submit = useCallback(
    async (body: CreateRunBody) => {
      setSubmitting(true);
      setIssues([]);
      setSubmitError(null);
      try {
        const { id, run: created } = await createRun(body);
        watch(id, created);
      } catch (err) {
        if (err instanceof ApiError) {
          setIssues(err.issues);
          setSubmitError(err.message);
        } else {
          setSubmitError(err instanceof Error ? err.message : "Could not start the run.");
        }
      } finally {
        setSubmitting(false);
      }
    },
    [watch],
  );

  const submitBatch = useCallback(async (body: CreateBatchBody) => {
    setBatchSubmitting(true);
    setIssues([]);
    setSubmitError(null);
    try {
      const { id } = await createBatch(body);
      setBatchId(id);
    } catch (err) {
      if (err instanceof ApiError) {
        setIssues(err.issues);
        setSubmitError(err.message);
      } else {
        setSubmitError(err instanceof Error ? err.message : "Could not start the batch.");
      }
    } finally {
      setBatchSubmitting(false);
    }
  }, []);

  const extend = useCallback(
    async (platform: Parameters<typeof extendRun>[1], additionalPrompt: string) => {
      if (!run) return;
      setSubmitError(null);
      try {
        const { id, run: created } = await extendRun(run.id, platform, additionalPrompt);
        watch(id, created);
      } catch (err) {
        setSubmitError(err instanceof Error ? err.message : "Could not start the extension.");
      }
    },
    [run, watch],
  );

  const openBatchRun = useCallback(
    (id: string) => {
      setMode("single");
      void openHistoryRun(id);
    },
    [openHistoryRun],
  );

  const summary = useMemo(() => {
    if (!run) return null;
    const statuses = run.order.map((p) => run.lanes[p]?.status ?? "queued");
    const count = (s: LaneStatus) => statuses.filter((x) => x === s).length;
    return { passed: count("passed"), failed: count("failed") + count("error"), skipped: count("skipped") };
  }, [run]);

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand__mark" aria-hidden="true">
            TL
          </span>
          <span>
            Test Lab
            <span className="brand__sub"> · prompt to verified WebdriverIO spec</span>
          </span>
        </div>
        <div className="topbar__spacer" />
        <button
          className="btn btn--ghost"
          type="button"
          onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
          aria-pressed={theme === "light"}
        >
          {theme === "dark" ? "Light" : "Dark"} theme
        </button>
      </header>

      <div className="layout">
        <div className="sidebar">
          <div className="mode-toggle" role="tablist" aria-label="Single or bulk">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "single"}
              className="mode-toggle__btn"
              onClick={() => setMode("single")}
            >
              Single test
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "bulk"}
              className="mode-toggle__btn"
              onClick={() => setMode("bulk")}
            >
              Bulk upload
            </button>
          </div>

          {mode === "single" ? (
            <Composer
              capabilities={capabilities}
              busy={submitting || live}
              issues={issues}
              onSubmit={submit}
              onCancel={() => run && void cancelRun(run.id)}
              canCancel={live}
            />
          ) : (
            <BatchUpload busy={batchSubmitting} issues={issues} onSubmit={submitBatch} />
          )}

          <History
            activeId={run?.id ?? null}
            refreshKey={historyRefresh}
            onSelect={openHistoryRun}
            onCleared={(removedIds) => {
              // The stage is showing a run that no longer exists; leaving it up
              // implies it is still there, and its stream is gone either way.
              if (run && removedIds.includes(run.id)) reset();
            }}
          />
        </div>

        <main className="stage">
          {bootError && (
            <p className="banner" data-tone="error" role="alert">
              {bootError}
            </p>
          )}
          {submitError && !issues.length && (
            <p className="banner" data-tone="error" role="alert">
              {submitError}
            </p>
          )}
          {runError && (
            <p className="banner" data-tone="error" role="alert">
              {runError}
            </p>
          )}
          {streamError && (
            <p className="banner" data-tone="warn" role="status">
              {streamError}
            </p>
          )}
          {capabilities && !capabilities.iosAvailable && (
            <p className="banner" data-tone="warn">
              iOS is unavailable: XCUITest needs macOS with Xcode, and this server runs on {capabilities.host}. Set
              CLOUD_PROVIDER and its credentials in .env to enable the iOS lane.
            </p>
          )}

          {mode === "bulk" && batchId ? (
            <BatchResults batchId={batchId} onOpenRun={openBatchRun} />
          ) : !run ? (
            <div className="stage-empty">
              <div className="stage-empty__mark" aria-hidden="true">
                ◍ ▲ ▮
              </div>
              <h2>{mode === "bulk" ? "Upload test cases to begin" : "Describe a test case to begin"}</h2>
              <p>
                {mode === "bulk"
                  ? "Each line becomes its own run through the exact same pipeline — explored, written, and verified cold, one at a time."
                  : "The agent opens a real browser and device, works through your scenario, writes a WebdriverIO spec from what it actually saw, then replays that spec in a fresh session to prove it holds up."}
              </p>
            </div>
          ) : (
            <>
              <div className="run-header">
                <h2>{run.prompt}</h2>
                <span className="run-header__id">{run.id.slice(0, 8)}</span>
                {summary && !live && (
                  <span className="run-header__id" role="status">
                    {summary.passed} passed · {summary.failed} failed
                    {summary.skipped ? ` · ${summary.skipped} skipped` : ""}
                  </span>
                )}
              </div>

              <div className="lanes">
                {run.order.map((platform) => {
                  const lane = run.lanes[platform];
                  return lane ? (
                    <LaneCard
                      key={platform}
                      runId={run.id}
                      lane={lane}
                      onZoom={setZoom}
                      onReverify={reverify}
                      onExtend={extend}
                    />
                  ) : null;
                })}
              </div>
            </>
          )}
        </main>
      </div>

      {zoom && <Lightbox src={zoom} onClose={() => setZoom(null)} />}
    </div>
  );
}
