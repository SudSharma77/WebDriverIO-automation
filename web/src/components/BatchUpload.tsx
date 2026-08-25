import { useId, useMemo, useRef, useState } from "react";
import type { CreateBatchBody } from "../api";
import { PLATFORMS, PLATFORM_LABEL, type Platform, type ServerCapabilities } from "../types";
import { Credentials } from "./Credentials";

interface Props {
  capabilities: ServerCapabilities | null;
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
 * its own URL after a `|` for the web lane. Android/iOS run the exact same app
 * and device across every case in the batch — that's the one target shape that
 * doesn't need per-line detail, so it stays a one-line-per-case format even
 * with a device lane selected.
 */
export function BatchUpload({ capabilities, busy, issues, onSubmit }: Props) {
  const ids = {
    text: useId(),
    defaultUrl: useId(),
    androidApp: useId(),
    iosApp: useId(),
    iosDevice: useId(),
    client: useId(),
    stability: useId(),
  };
  const fileRef = useRef<HTMLInputElement>(null);

  const [text, setText] = useState("");
  const [selected, setSelected] = useState<Platform[]>(["web"]);
  const [defaultUrl, setDefaultUrl] = useState("");
  const [androidApp, setAndroidApp] = useState("");
  const [iosApp, setIosApp] = useState("");
  const [iosDeviceName, setIosDeviceName] = useState("iPhone 15 Pro");
  const [headless, setHeadless] = useState(false);
  const [stabilityRuns, setStabilityRuns] = useState(0);
  const [clientId, setClientId] = useState("default");
  const [secrets, setSecrets] = useState<Array<{ name: string; value: string }>>([]);

  const iosBlocked = capabilities !== null && !capabilities.iosAvailable;
  const needsUrl = selected.includes("web");

  const { cases, lineErrors } = useMemo(
    () => parseCases(text, defaultUrl, needsUrl),
    [text, defaultUrl, needsUrl],
  );

  const issueFor = useMemo(() => {
    const map = new Map(issues.map((i) => [i.path, i.message]));
    return (path: string) => map.get(path);
  }, [issues]);

  const toggle = (platform: Platform) => {
    setSelected((current) =>
      current.includes(platform) ? current.filter((p) => p !== platform) : [...current, platform],
    );
  };

  const canSubmit = !busy && selected.length > 0 && cases.length > 0 && lineErrors.length === 0;

  const onFile = async (file: File) => {
    setText(await file.text());
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    onSubmit({
      cases: cases.map((c) => ({
        prompt: c.prompt,
        target: {
          webUrl: needsUrl ? c.url : undefined,
          androidApp: selected.includes("android") ? androidApp.trim() || undefined : undefined,
          iosApp: selected.includes("ios") ? iosApp.trim() || undefined : undefined,
          iosDeviceName: selected.includes("ios") ? iosDeviceName.trim() || undefined : undefined,
        },
      })),
      platforms: selected,
      headless,
      stabilityRuns,
      clientId: clientId.trim() || "default",
      secrets: Object.fromEntries(
        secrets
          .filter((secret) => secret.name.trim() && secret.value)
          .map((secret) => [secret.name.trim().toUpperCase(), secret.value]),
      ),
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
          {needsUrl ? (
            <>
              Each line is <code>prompt | url</code>. Omit the <code>| url</code> part to use the default URL below.
            </>
          ) : (
            <>
              Each line is one test case. The <code>| url</code> suffix is ignored on device lanes — every case runs
              against the app set below.
            </>
          )}
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

      <fieldset disabled={busy}>
        <legend>Platforms</legend>
        <div className="platforms">
          {PLATFORMS.map((platform) => {
            const disabled = platform === "ios" && iosBlocked;
            return (
              <label
                key={platform}
                className="platform-toggle"
                style={{ ["--tint" as string]: `var(--${platform})` }}
              >
                <input
                  type="checkbox"
                  checked={selected.includes(platform)}
                  onChange={() => toggle(platform)}
                  disabled={disabled}
                />
                <span className="platform-toggle__name">{PLATFORM_LABEL[platform]}</span>
                {platform === "ios" && (
                  <span className="platform-toggle__note">
                    {iosBlocked ? "no cloud farm configured" : (capabilities?.cloudProvider ?? "cloud")}
                  </span>
                )}
                {platform === "android" && <span className="platform-toggle__note">local Appium</span>}
                {platform === "web" && <span className="platform-toggle__note">local Chrome</span>}
              </label>
            );
          })}
        </div>
        {selected.length === 0 && <p className="field__error">Pick at least one platform.</p>}
      </fieldset>

      {needsUrl && (
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
        </div>
      )}

      {issueFor("cases") && <p className="field__error">{issueFor("cases")}</p>}

      {selected.includes("android") && (
        <div className="field">
          <label className="field__label" htmlFor={ids.androidApp}>
            Android .apk
          </label>
          <input
            id={ids.androidApp}
            className="input"
            value={androidApp}
            onChange={(e) => setAndroidApp(e.target.value)}
            placeholder="C:\\apps\\demo.apk"
            aria-describedby={`${ids.androidApp}-hint`}
            disabled={busy}
          />
          <p className="field__hint" id={`${ids.androidApp}-hint`}>
            Absolute path on this machine, same app for every case. Appium must be running at{" "}
            {capabilities?.appiumUrl ?? "127.0.0.1:4723"}.
          </p>
        </div>
      )}

      {selected.includes("ios") && (
        <>
          <div className="field">
            <label className="field__label" htmlFor={ids.iosApp}>
              iOS app id
            </label>
            <input
              id={ids.iosApp}
              className="input"
              value={iosApp}
              onChange={(e) => setIosApp(e.target.value)}
              placeholder="bs://a1b2c3d4e5"
              aria-describedby={`${ids.iosApp}-hint`}
              disabled={busy}
            />
            <p className="field__hint" id={`${ids.iosApp}-hint`}>
              Same app for every case. Upload the .ipa to {capabilities?.cloudProvider ?? "your farm"} first and
              paste the id it returns.
            </p>
          </div>
          <div className="field">
            <label className="field__label" htmlFor={ids.iosDevice}>
              iOS device
            </label>
            <input
              id={ids.iosDevice}
              className="input"
              value={iosDeviceName}
              onChange={(e) => setIosDeviceName(e.target.value)}
              disabled={busy}
            />
          </div>
        </>
      )}

      {lineErrors.length > 0 && (
        <p className="field__error">
          {lineErrors.map((e) => `Line ${e.line}: ${e.message}`).join(" · ")}
        </p>
      )}

      {needsUrl && (
        <label className="platform-toggle" style={{ ["--tint" as string]: "var(--web)" }}>
          <input type="checkbox" checked={headless} onChange={(e) => setHeadless(e.target.checked)} disabled={busy} />
          <span className="platform-toggle__name">Headless Chrome</span>
          <span className="platform-toggle__note">faster, no window</span>
        </label>
      )}

      <Credentials
        secrets={secrets}
        onChange={setSecrets}
        busy={busy}
        hint="Add one row per value the login needs. Applied to every case in this batch — one login, tested across many
          scenarios. Values go to the browser under test and nowhere else."
      />

      <div className="field">
        <label className="field__label" htmlFor={ids.client}>
          Client
        </label>
        <input
          id={ids.client}
          className="input"
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          placeholder="default"
          pattern="[a-z0-9][a-z0-9-]*"
          spellCheck={false}
          aria-describedby={`${ids.client}-hint`}
          disabled={busy}
        />
        <p className="field__hint" id={`${ids.client}-hint`}>
          Whose suite this grows. Every case in the batch accumulates under <code>clients/{clientId.trim() || "default"}/</code>.
        </p>
      </div>

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

function parseCases(
  text: string,
  defaultUrl: string,
  needsUrl: boolean,
): { cases: ParsedCase[]; lineErrors: Array<{ line: number; message: string }> } {
  const cases: ParsedCase[] = [];
  const lineErrors: Array<{ line: number; message: string }> = [];

  text.split("\n").forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;

    // On a device-only batch the `| suffix` isn't a URL field at all, so a
    // stray `|` in the prompt text itself (rare, but plausible) shouldn't be
    // sliced off.
    const pipeIndex = needsUrl ? line.lastIndexOf("|") : -1;
    const prompt = (pipeIndex >= 0 ? line.slice(0, pipeIndex) : line).trim();
    const url = (pipeIndex >= 0 ? line.slice(pipeIndex + 1) : defaultUrl).trim();

    if (prompt.length < 10) {
      lineErrors.push({ line: i + 1, message: "test case needs a sentence or two" });
      return;
    }
    if (needsUrl && !url) {
      lineErrors.push({ line: i + 1, message: "no URL (and no default URL set)" });
      return;
    }
    cases.push({ prompt, url, line: i + 1 });
  });

  return { cases, lineErrors };
}
