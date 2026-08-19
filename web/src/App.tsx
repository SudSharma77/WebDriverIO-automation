import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, cancelRun, createRun, fetchCapabilities, type CreateRunBody } from "./api";
import { Composer } from "./components/Composer";
import { LaneCard } from "./components/LaneCard";
import { Lightbox } from "./components/Lightbox";
import type { LaneStatus, ServerCapabilities } from "./types";
import { useRun } from "./useRun";

type Theme = "dark" | "light";

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

  const { run, streamError, runError, watch } = useRun();

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

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
        <Composer
          capabilities={capabilities}
          busy={submitting || live}
          issues={issues}
          onSubmit={submit}
          onCancel={() => run && void cancelRun(run.id)}
          canCancel={live}
        />

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

          {!run ? (
            <div className="stage-empty">
              <div className="stage-empty__mark" aria-hidden="true">
                ◍ ▲ ▮
              </div>
              <h2>Describe a test case to begin</h2>
              <p>
                The agent opens a real browser and device, works through your scenario, writes a WebdriverIO spec from
                what it actually saw, then replays that spec in a fresh session to prove it holds up.
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
                    <LaneCard key={platform} runId={run.id} lane={lane} onZoom={setZoom} />
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
