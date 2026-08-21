import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, cancelRun, createRun, fetchCapabilities, type CreateRunBody } from "./api";
import { Composer } from "./components/Composer";
import { LaneCard } from "./components/LaneCard";
import { Lightbox } from "./components/Lightbox";
import type { ServerCapabilities } from "./types";
import { useRun } from "./useRun";

type Theme = "dark" | "light";

/**
 * Prompt in, verified test out.
 *
 * One primary action on the screen — describe a test case and run it — with
 * everything the run produced arranged in the order the user cares about:
 * did it pass, what did it write, and only then how it got there.
 */
export default function App() {
  const [capabilities, setCapabilities] = useState<ServerCapabilities | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [issues, setIssues] = useState<Array<{ path: string; message: string }>>([]);
  const [starting, setStarting] = useState(false);
  const [zoomed, setZoomed] = useState<string | null>(null);

  const { run, streamError, runError, watch, reset } = useRun();

  const [theme, setTheme] = useState<Theme>("dark");
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    fetchCapabilities()
      .then(setCapabilities)
      .catch(() =>
        setBootError("Cannot reach the backend. Start it with `npm run dev:server`, then reload this page."),
      );
  }, []);

  const running = useMemo(() => {
    if (!run || run.finishedAt) return false;
    return Object.values(run.lanes).some((lane) => lane.status === "running" || lane.status === "queued");
  }, [run]);

  const submit = useCallback(
    async (body: CreateRunBody) => {
      setStarting(true);
      setSubmitError(null);
      setIssues([]);
      reset();

      try {
        const { id, run: seed } = await createRun(body);
        watch(id, seed);
      } catch (err) {
        if (err instanceof ApiError) {
          setSubmitError(err.message);
          setIssues(err.issues);
        } else {
          setSubmitError(err instanceof Error ? err.message : "Could not start the run.");
        }
      } finally {
        setStarting(false);
      }
    },
    [reset, watch],
  );

  const stop = useCallback(() => {
    if (run) void cancelRun(run.id);
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
            <span className="brand__sub"> · describe a test, get a verified one</span>
          </span>
        </div>
        <div className="topbar__spacer" />
        {run && (
          <code className="topbar__path" title={`Suite: clients/${run.clientId}`}>
            clients/{run.clientId}
          </code>
        )}
        <button
          className="btn btn--ghost"
          type="button"
          onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
          aria-pressed={theme === "light"}
        >
          {theme === "dark" ? "Light" : "Dark"}
        </button>
      </header>

      <div className="layout">
        <aside>
          <Composer
            capabilities={capabilities}
            busy={starting || running}
            issues={issues}
            onSubmit={submit}
            onCancel={stop}
            canCancel={running}
          />
        </aside>

        <main className="stage" aria-live="polite">
          {bootError && (
            <p className="banner" data-tone="error" role="alert">
              {bootError}
            </p>
          )}
          {submitError && (
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

          {!run ? (
            <Welcome capabilities={capabilities} />
          ) : (
            <>
              <RunSummary run={run} running={running} />
              <div className="lanes">
                {run.order.map((platform) => {
                  const lane = run.lanes[platform];
                  return lane ? (
                    <LaneCard key={platform} runId={run.id} lane={lane} onZoom={setZoomed} />
                  ) : null;
                })}
              </div>
            </>
          )}
        </main>
      </div>

      {zoomed && <Lightbox src={zoomed} onClose={() => setZoomed(null)} />}
    </div>
  );
}

function RunSummary({ run, running }: { run: NonNullable<ReturnType<typeof useRun>["run"]>; running: boolean }) {
  const lanes = run.order.map((platform) => run.lanes[platform]).filter(Boolean);
  const passed = lanes.filter((lane) => lane!.status === "passed").length;
  const done = lanes.filter((lane) => ["passed", "failed", "error", "skipped"].includes(lane!.status)).length;

  return (
    <section className="runsummary">
      <p className="runsummary__prompt">{run.prompt}</p>
      <div className="runsummary__facts">
        <span>{run.target.webUrl ?? run.target.androidApp ?? run.target.iosApp ?? "no target"}</span>
        {run.secretNames.length > 0 && (
          <span title="Names only — values are never sent back to this page">
            {run.secretNames.join(", ")}
          </span>
        )}
        <span>
          {running ? `${done} of ${lanes.length} finished` : `${passed} of ${lanes.length} passed`}
        </span>
      </div>
    </section>
  );
}

function Welcome({ capabilities }: { capabilities: ServerCapabilities | null }) {
  return (
    <div className="stage-empty">
      <div className="stage-empty__mark" aria-hidden="true">
        ⌘
      </div>
      <h2>Describe a test case</h2>
      <p>
        It opens your app for real, works through the scenario, writes a WebdriverIO spec from what it actually saw,
        then replays that spec on a cold session to prove it passes.
      </p>
      <p>
        Everything verified is saved into the client&rsquo;s suite — specs, page objects and locators — so the next run
        reuses them instead of starting over.
      </p>
      {capabilities && (
        <p className="stage-empty__meta">
          {capabilities.llm.model} on {capabilities.llm.provider}
          {!capabilities.iosAvailable && " · iOS needs a cloud device farm"}
        </p>
      )}
    </div>
  );
}
