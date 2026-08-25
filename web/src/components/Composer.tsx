import { useId, useMemo, useState } from "react";
import type { CreateRunBody } from "../api";
import { PLATFORMS, PLATFORM_LABEL, type Platform, type ServerCapabilities } from "../types";
import { Credentials } from "./Credentials";

interface Props {
  capabilities: ServerCapabilities | null;
  busy: boolean;
  issues: Array<{ path: string; message: string }>;
  onSubmit: (body: CreateRunBody) => void;
  onCancel: () => void;
  canCancel: boolean;
}

const EXAMPLE =
  "Add the first product on the catalogue page to the cart, open the cart, and confirm it shows exactly one item with the correct name and price.";

export function Composer({ capabilities, busy, issues, onSubmit, onCancel, canCancel }: Props) {
  const ids = {
    prompt: useId(),
    webUrl: useId(),
    androidApp: useId(),
    iosApp: useId(),
    iosDevice: useId(),
    client: useId(),
    stability: useId(),
  };

  const [prompt, setPrompt] = useState("");
  const [selected, setSelected] = useState<Platform[]>(["web"]);
  const [headless, setHeadless] = useState(false);
  const [stabilityRuns, setStabilityRuns] = useState(0);
  const [webUrl, setWebUrl] = useState("");
  const [androidApp, setAndroidApp] = useState("");
  const [iosApp, setIosApp] = useState("");
  const [iosDeviceName, setIosDeviceName] = useState("iPhone 15 Pro");
  const [clientId, setClientId] = useState("default");
  const [secrets, setSecrets] = useState<Array<{ name: string; value: string }>>([]);

  const iosBlocked = capabilities !== null && !capabilities.iosAvailable;

  const issueFor = useMemo(() => {
    const map = new Map(issues.map((i) => [i.path, i.message]));
    return (path: string) => map.get(path);
  }, [issues]);

  const toggle = (platform: Platform) => {
    setSelected((current) =>
      current.includes(platform) ? current.filter((p) => p !== platform) : [...current, platform],
    );
  };

  const promptTooShort = prompt.trim().length > 0 && prompt.trim().length < 10;
  const canSubmit = !busy && prompt.trim().length >= 10 && selected.length > 0;

  const doSubmit = () => {
    if (!canSubmit) return;
    onSubmit({
      prompt: prompt.trim(),
      platforms: selected,
      headless,
      clientId: clientId.trim() || "default",
      secrets: Object.fromEntries(
        secrets
          .filter((secret) => secret.name.trim() && secret.value)
          .map((secret) => [secret.name.trim().toUpperCase(), secret.value]),
      ),
      stabilityRuns,
      target: {
        webUrl: webUrl.trim() || undefined,
        androidApp: androidApp.trim() || undefined,
        iosApp: iosApp.trim() || undefined,
        iosDeviceName: iosDeviceName.trim() || undefined,
      },
    });
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    doSubmit();
  };

  /** Ctrl/Cmd+Enter submits from inside the textarea without breaking normal Enter (newline). */
  const onPromptKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      doSubmit();
    }
  };

  return (
    <form className="panel" onSubmit={submit} noValidate>
      <div className="field">
        <label className="field__label" htmlFor={ids.prompt}>
          Test case
        </label>
        <textarea
          id={ids.prompt}
          className="textarea"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={onPromptKeyDown}
          placeholder={EXAMPLE}
          aria-invalid={promptTooShort || undefined}
          aria-describedby={`${ids.prompt}-hint`}
          disabled={busy}
        />
        <p className="field__hint" id={`${ids.prompt}-hint`}>
          {promptTooShort
            ? "A little more detail — name the screen, the action and what proves it worked."
            : "Describe it as you would to a colleague. Name what proves the scenario passed."}
          {" "}
          <kbd>Ctrl/Cmd+Enter</kbd> to run.
        </p>
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

      {selected.includes("web") && (
        <div className="field">
          <label className="field__label" htmlFor={ids.webUrl}>
            Web URL
          </label>
          <input
            id={ids.webUrl}
            className="input"
            type="url"
            inputMode="url"
            value={webUrl}
            onChange={(e) => setWebUrl(e.target.value)}
            placeholder="https://the-internet.herokuapp.com"
            aria-invalid={!!issueFor("target.webUrl") || undefined}
            disabled={busy}
          />
          {issueFor("target.webUrl") && <p className="field__error">{issueFor("target.webUrl")}</p>}
        </div>
      )}

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
            aria-invalid={!!issueFor("target.androidApp") || undefined}
            aria-describedby={`${ids.androidApp}-hint`}
            disabled={busy}
          />
          <p className="field__hint" id={`${ids.androidApp}-hint`}>
            Absolute path on this machine. Appium must be running at {capabilities?.appiumUrl ?? "127.0.0.1:4723"}.
          </p>
          {issueFor("target.androidApp") && <p className="field__error">{issueFor("target.androidApp")}</p>}
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
              aria-invalid={!!issueFor("target.iosApp") || undefined}
              aria-describedby={`${ids.iosApp}-hint`}
              disabled={busy}
            />
            <p className="field__hint" id={`${ids.iosApp}-hint`}>
              Upload the .ipa to {capabilities?.cloudProvider ?? "your farm"} first and paste the id it returns — a
              local path is not reachable from a cloud device.
            </p>
            {issueFor("target.iosApp") && <p className="field__error">{issueFor("target.iosApp")}</p>}
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

      {selected.includes("web") && (
        <label className="platform-toggle" style={{ ["--tint" as string]: "var(--web)" }}>
          <input
            type="checkbox"
            checked={headless}
            onChange={(e) => setHeadless(e.target.checked)}
            disabled={busy}
          />
          <span className="platform-toggle__name">Headless Chrome</span>
          <span className="platform-toggle__note">faster, no window</span>
        </label>
      )}

      <Credentials
        secrets={secrets}
        onChange={setSecrets}
        busy={busy}
        hint="Add one row per value the login needs — usually a username and a password. Values go to the browser under
          test and nowhere else; the saved spec reads them from the environment, so nothing is written to a file."
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
          aria-invalid={!!issueFor("clientId") || undefined}
          disabled={busy}
        />
        <p className="field__hint" id={`${ids.client}-hint`}>
          Whose suite this grows. Specs, page objects and locators accumulate under{" "}
          <code>clients/{clientId.trim() || "default"}/</code> and are reused on the next run.
        </p>
        {issueFor("clientId") && <p className="field__error">{issueFor("clientId")}</p>}
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
        <p className="field__hint">
          After a spec passes, replay it again cold to catch timing-dependent flakiness before you trust it.
        </p>
      </div>

      <div style={{ marginTop: "var(--space-5)", display: "grid", gap: "var(--space-2)" }}>
        <button className="btn btn--primary" type="submit" disabled={!canSubmit}>
          {busy && <span className="spinner" aria-hidden="true" />}
          {busy ? "Running…" : "Generate & verify"}
        </button>
        {canCancel && (
          <button className="btn btn--ghost" type="button" onClick={onCancel}>
            Cancel run
          </button>
        )}
      </div>

      {capabilities && (
        <p className="field__hint" style={{ marginTop: "var(--space-4)" }}>
          Up to {capabilities.maxAgentSteps} device actions per platform, driven by{" "}
          <strong>{capabilities.llm.model}</strong> on {capabilities.llm.provider}.
          {!capabilities.llm.sendsScreenshots &&
            " Screenshots are captured for you but not sent to the model, to save tokens."}
        </p>
      )}
    </form>
  );
}
