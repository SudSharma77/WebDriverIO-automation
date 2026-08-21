import { useId, useMemo, useRef, useState } from "react";
import type { CreateBatchBody } from "../api";

interface Props {
  busy: boolean;
  issues: Array<{ path: string; message: string }>;
  onSubmit: (body: CreateBatchBody) => void;
}

const EXAMPLE = `Check the first checkbox and verify it is checked. | https://the-internet.herokuapp.com/checkboxes
Open the dropdown and select Option 2. | https://the-internet.herokuapp.com/dropdown
Click Add Element three times and verify three delete buttons appear. | https://the-internet.herokuapp.com/add_remove_elements/`;

interface ParsedCase {
  prompt: string;
  url: string;
  line: number;
}

/**
 * Bulk mode: upload or paste one test case per line, each optionally carrying
 * its own URL after a `|`. Web only for now — Android/iOS need a different
 * target shape per case (app path, device name), which would turn a one-line
 * format into something nobody wants to hand-write in a text file.
 */
export function BatchUpload({ busy, issues, onSubmit }: Props) {
  const ids = { text: useId(), defaultUrl: useId(), stability: useId() };
  const fileRef = useRef<HTMLInputElement>(null);

  const [text, setText] = useState("");
  const [defaultUrl, setDefaultUrl] = useState("");
  const [headless, setHeadless] = useState(false);
  const [stabilityRuns, setStabilityRuns] = useState(0);

  const { cases, lineErrors } = useMemo(() => parseCases(text, defaultUrl), [text, defaultUrl]);

  const issueFor = useMemo(() => {
    const map = new Map(issues.map((i) => [i.path, i.message]));
    return (path: string) => map.get(path);
  }, [issues]);

  const canSubmit = !busy && cases.length > 0 && lineErrors.length === 0;

  const onFile = async (file: File) => {
    setText(await file.text());
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    onSubmit({
      cases: cases.map((c) => ({ prompt: c.prompt, target: { webUrl: c.url } })),
      platforms: ["web"],
      headless,
      stabilityRuns,
    });
  };

  return (
    <form className="panel" onSubmit={submit} noValidate>
      <div className="field">
        <label className="field__label" htmlFor={ids.text}>
          Test cases (one per line)
        </label>
        <textarea
          id={ids.text}
          className="textarea"
          rows={8}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={EXAMPLE}
          disabled={busy}
        />
        <p className="field__hint">
          Each line is <code>prompt | url</code>. Omit the <code>| url</code> part to use the default URL below.
        </p>
        <div className="panel-actions">
          <button
            className="btn btn--ghost"
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
          >
            Upload .txt / .csv
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".txt,.csv,text/plain,text/csv"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void onFile(file);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      <div className="field">
        <label className="field__label" htmlFor={ids.defaultUrl}>
          Default URL
        </label>
        <input
          id={ids.defaultUrl}
          className="input"
          type="url"
          inputMode="url"
          value={defaultUrl}
          onChange={(e) => setDefaultUrl(e.target.value)}
          placeholder="https://example.com"
          disabled={busy}
        />
        <p className="field__hint">Used for any line that doesn't specify its own URL.</p>
        {issueFor("cases") && <p className="field__error">{issueFor("cases")}</p>}
      </div>

      {lineErrors.length > 0 && (
        <p className="field__error">
          {lineErrors.map((e) => `Line ${e.line}: ${e.message}`).join(" · ")}
        </p>
      )}

      <label className="platform-toggle" style={{ ["--tint" as string]: "var(--web)" }}>
        <input type="checkbox" checked={headless} onChange={(e) => setHeadless(e.target.checked)} disabled={busy} />
        <span className="platform-toggle__name">Headless Chrome</span>
        <span className="platform-toggle__note">faster, no window</span>
      </label>

      <div className="field">
        <label className="field__label" htmlFor={ids.stability}>
          Stability check
        </label>
        <select
          id={ids.stability}
          className="input"
          value={stabilityRuns}
          onChange={(e) => setStabilityRuns(Number(e.target.value))}
          disabled={busy}
        >
          <option value={0}>Off — one cold run is enough</option>
          <option value={2}>Repeat 2 more times</option>
          <option value={4}>Repeat 4 more times</option>
        </select>
      </div>

      <div style={{ marginTop: "var(--space-5)", display: "grid", gap: "var(--space-2)" }}>
        <button className="btn btn--primary" type="submit" disabled={!canSubmit}>
          {busy && <span className="spinner" aria-hidden="true" />}
          {busy ? "Running batch…" : `Run ${cases.length || ""} test case${cases.length === 1 ? "" : "s"}`}
        </button>
      </div>

      <p className="field__hint" style={{ marginTop: "var(--space-4)" }}>
        Cases run one at a time, in order — not in parallel — since they share the same rate-limited model key. Up to
        50 per batch.
      </p>
    </form>
  );
}

function parseCases(text: string, defaultUrl: string): { cases: ParsedCase[]; lineErrors: Array<{ line: number; message: string }> } {
  const cases: ParsedCase[] = [];
  const lineErrors: Array<{ line: number; message: string }> = [];

  text.split("\n").forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;

    const pipeIndex = line.lastIndexOf("|");
    const prompt = (pipeIndex >= 0 ? line.slice(0, pipeIndex) : line).trim();
    const url = (pipeIndex >= 0 ? line.slice(pipeIndex + 1) : defaultUrl).trim();

    if (prompt.length < 10) {
      lineErrors.push({ line: i + 1, message: "test case needs a sentence or two" });
      return;
    }
    if (!url) {
      lineErrors.push({ line: i + 1, message: "no URL (and no default URL set)" });
      return;
    }
    cases.push({ prompt, url, line: i + 1 });
  });

  return { cases, lineErrors };
}
