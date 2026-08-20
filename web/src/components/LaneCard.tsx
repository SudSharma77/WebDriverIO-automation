import { useEffect, useId, useRef, useState } from "react";
import { projectDownloadUrl, specDownloadUrl } from "../api";
import { diffLines } from "../diff";
import { highlightJs } from "../highlight";
import { PLATFORM_GLYPH, PLATFORM_LABEL, type LaneState, type Platform } from "../types";
import { PhaseRail } from "./PhaseRail";
import { StatusPill } from "./StatusPill";
import { TokenBadge } from "./TokenBadge";

type TabKey = "steps" | "screens" | "spec" | "logs";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "steps", label: "Steps" },
  { key: "screens", label: "Screens" },
  { key: "spec", label: "Spec" },
  { key: "logs", label: "Run log" },
];

interface Props {
  runId: string;
  lane: LaneState;
  onZoom: (dataUrl: string) => void;
  onReverify: (platform: Platform) => void;
  onExtend: (platform: Platform, additionalPrompt: string) => void;
}

export function LaneCard({ runId, lane, onZoom, onReverify, onExtend }: Props) {
  const [tab, setTab] = useState<TabKey>("steps");
  const baseId = useId();
  const tablistRef = useRef<HTMLDivElement>(null);

  // Once a spec exists it is the thing the user came for — surface it without
  // making them hunt for the tab.
  const sawSpec = useRef(false);
  useEffect(() => {
    if (lane.specCode && !sawSpec.current) {
      sawSpec.current = true;
      setTab("spec");
    }
  }, [lane.specCode]);

  const counts: Record<TabKey, number> = {
    steps: lane.steps.length,
    screens: lane.screenshots.length,
    spec: lane.specCode ? 1 : 0,
    logs: lane.verifyLog.length,
  };

  /** Arrow-key navigation is expected of a tablist and costs almost nothing. */
  const onTabKeyDown = (event: React.KeyboardEvent) => {
    const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!delta) return;
    event.preventDefault();
    const index = TABS.findIndex((t) => t.key === tab);
    const next = TABS[(index + delta + TABS.length) % TABS.length]!;
    setTab(next.key);
    tablistRef.current?.querySelector<HTMLButtonElement>(`#${CSS.escape(`${baseId}-${next.key}`)}`)?.focus();
  };

  const showDetail = lane.detail && lane.status !== "running";

  return (
    <section className="lane" data-platform={lane.platform} aria-label={`${PLATFORM_LABEL[lane.platform]} lane`}>
      <header className="lane__head">
        <span className="lane__icon" aria-hidden="true">
          {PLATFORM_GLYPH[lane.platform]}
        </span>
        <div>
          <div className="lane__title">{PLATFORM_LABEL[lane.platform]}</div>
          <div className="lane__meta">
            {lane.toolCallCount} action{lane.toolCallCount === 1 ? "" : "s"}
            {lane.startedAt && lane.finishedAt ? ` · ${Math.round((lane.finishedAt - lane.startedAt) / 1000)}s` : ""}
            {" "}
            <TokenBadge usage={lane.usage} />
          </div>
        </div>
        <div className="lane__head-right">
          <StatusPill status={lane.status} />
        </div>
      </header>

      <PhaseRail phase={lane.phase} status={lane.status} />

      {showDetail && (
        <p className="lane__detail" data-tone={lane.status} role="status">
          {lane.detail}
        </p>
      )}

      <div className="tabs" role="tablist" ref={tablistRef} onKeyDown={onTabKeyDown} aria-label="Lane output">
        {TABS.map((t) => (
          <button
            key={t.key}
            id={`${baseId}-${t.key}`}
            className="tab"
            role="tab"
            type="button"
            aria-selected={tab === t.key}
            aria-controls={`${baseId}-${t.key}-panel`}
            tabIndex={tab === t.key ? 0 : -1}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            {counts[t.key] > 0 && t.key !== "spec" && <span className="tab__count">{counts[t.key]}</span>}
          </button>
        ))}
      </div>

      <div
        className="tabpanel"
        role="tabpanel"
        id={`${baseId}-${tab}-panel`}
        aria-labelledby={`${baseId}-${tab}`}
        tabIndex={0}
      >
        {tab === "steps" && <Steps lane={lane} />}
        {tab === "screens" && <Screens lane={lane} onZoom={onZoom} />}
        {tab === "spec" && (
          <Spec runId={runId} lane={lane} onExtend={(text) => onExtend(lane.platform, text)} />
        )}
        {tab === "logs" && <Logs lane={lane} onReverify={() => onReverify(lane.platform)} />}
      </div>
    </section>
  );
}

function Steps({ lane }: { lane: LaneState }) {
  if (lane.steps.length === 0 && !lane.narration?.length) {
    return (
      <Empty
        title={lane.status === "queued" ? "Waiting to start" : "No actions yet"}
        body={
          lane.status === "skipped"
            ? "This lane was skipped before it opened a session."
            : "Device actions appear here as the agent performs them."
        }
      />
    );
  }

  return (
    <>
      {lane.narration?.map((text, i) => (
        <p className="narration" key={i}>
          {text}
        </p>
      ))}
      <ul className="steps">
        {lane.steps.map((step) => (
          <li className="step" key={step.id}>
            <span className="step__icon" data-ok={step.ok === undefined ? "pending" : String(step.ok)}>
              {step.ok === undefined ? "•" : step.ok ? "✓" : "✗"}
            </span>
            <span>
              <span className="step__name">{step.name}</span>
              {step.summary && <span className="step__summary"> — {step.summary}</span>}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

function Screens({ lane, onZoom }: { lane: LaneState; onZoom: (dataUrl: string) => void }) {
  if (lane.screenshots.length === 0) {
    return <Empty title="No screenshots yet" body="The agent captures the screen as it works through the scenario." />;
  }
  return (
    <div className="shots">
      {lane.screenshots.map((shot) => (
        <button key={shot.id} className="shot" type="button" onClick={() => onZoom(shot.dataUrl)}>
          <img src={shot.dataUrl} alt={`Screen capture from ${shot.caption ?? "the device"}`} loading="lazy" />
          <span className="shot__cap">{new Date(shot.at).toLocaleTimeString()}</span>
        </button>
      ))}
    </div>
  );
}

function Spec({ runId, lane, onExtend }: { runId: string; lane: LaneState; onExtend: (text: string) => void }) {
  const [copied, setCopied] = useState(false);
  const hasDiff = !!lane.previousSpecCode && lane.previousSpecCode !== lane.specCode;
  const [showDiff, setShowDiff] = useState(hasDiff);
  const [extending, setExtending] = useState(false);
  const [extendText, setExtendText] = useState("");

  if (!lane.specCode) {
    return (
      <Empty
        title="No spec yet"
        body="The generated WebdriverIO spec appears once the agent finishes exploring the device."
      />
    );
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(lane.specCode!);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  const canExtend = lane.status === "passed";

  const submitExtend = (event: React.FormEvent) => {
    event.preventDefault();
    if (extendText.trim().length < 10) return;
    onExtend(extendText.trim());
    setExtendText("");
    setExtending(false);
  };

  return (
    <>
      <div className="panel-actions">
        {hasDiff && (
          <button className="btn btn--ghost" type="button" onClick={() => setShowDiff((v) => !v)}>
            {showDiff ? "Show final code" : "Show repair diff"}
          </button>
        )}
        <button className="btn btn--ghost" type="button" onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </button>
        <a className="btn btn--ghost" href={specDownloadUrl(runId, lane.platform)} download>
          Download spec
        </a>
        <a className="btn btn--ghost" href={projectDownloadUrl(runId, lane.platform)} download>
          Export project (.zip)
        </a>
        {canExtend && (
          <button className="btn btn--ghost" type="button" onClick={() => setExtending((v) => !v)}>
            {extending ? "Cancel" : "Extend this test"}
          </button>
        )}
      </div>
      {canExtend && extending && (
        <form className="extend-form" onSubmit={submitExtend}>
          <textarea
            className="textarea"
            rows={2}
            value={extendText}
            onChange={(e) => setExtendText(e.target.value)}
            placeholder="Add more steps to this scenario — e.g. Then also verify the total price updates."
            autoFocus
          />
          <p className="field__hint">
            The existing steps replay for free (no AI cost); only this additional part spends tokens.
          </p>
          <button className="btn btn--primary" type="submit" disabled={extendText.trim().length < 10}>
            Run extension
          </button>
        </form>
      )}
      {showDiff && hasDiff ? (
        <SpecDiff before={lane.previousSpecCode!} after={lane.specCode} />
      ) : (
        <pre className="code">
          <code>{highlightJs(lane.specCode)}</code>
        </pre>
      )}
    </>
  );
}

function SpecDiff({ before, after }: { before: string; after: string }) {
  const lines = diffLines(before, after);
  return (
    <pre className="code code--diff">
      <code>
        {lines.map((line, i) => (
          <div className="diff-line" data-type={line.type} key={i}>
            <span className="diff-line__marker" aria-hidden="true">
              {line.type === "add" ? "+" : line.type === "remove" ? "−" : " "}
            </span>
            {highlightJs(line.text)}
          </div>
        ))}
      </code>
    </pre>
  );
}

function Logs({ lane, onReverify }: { lane: LaneState; onReverify: () => void }) {
  const ref = useRef<HTMLPreElement>(null);

  // Follow the tail while the run is live, but never yank the view away from
  // someone who has scrolled up to read a failure.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    if (atBottom) el.scrollTop = el.scrollHeight;
  }, [lane.verifyLog.length]);

  const canReverify = !!lane.specCode && lane.status !== "running" && lane.status !== "queued";

  return (
    <>
      {canReverify && (
        <div className="panel-actions">
          <button className="btn btn--ghost" type="button" onClick={onReverify}>
            Re-check against live site
          </button>
        </div>
      )}
      {lane.verifyLog.length === 0 ? (
        <Empty title="No run log yet" body="Output from the WebdriverIO replay lands here." />
      ) : (
        <pre className="log" ref={ref}>
          {lane.verifyLog.join("\n")}
        </pre>
      )}
    </>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="empty">
      <div className="empty__title">{title}</div>
      <div>{body}</div>
    </div>
  );
}
