import { useCallback, useEffect, useId, useState } from "react";
import { ApiError, fetchClients, linkClientRepo, onboardClient } from "../api";
import type { ClientRecord } from "../types";
import { Reviews } from "./Reviews";

/**
 * Onboarding and repo-linking, in its own tab for the same reason History
 * got one: this is a distinct activity from composing a run, not a strip
 * that should be squeezed under it.
 *
 * A client here needs no repo at all to be usable elsewhere in the app — the
 * free-text `clientId` field on Composer/BatchUpload keeps working exactly
 * as it did before this existed, saving locally under `clients/<id>/`. This
 * tab is only for the clients that should also get pushed to a real repo.
 */
export function Clients() {
  const [clients, setClients] = useState<ClientRecord[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setClients(await fetchClients());
    } catch {
      setClients([]);
      setNote("Could not reach the server for the client list.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="clients" aria-label="Clients">
      <div className="clients__head">
        <h3 className="clients__title">Clients{clients?.length ? ` · ${clients.length}` : ""}</h3>
      </div>

      {note && (
        <p className="clients__note" role="status">
          {note}
        </p>
      )}

      <OnboardForm
        onOnboarded={(client) => {
          setNote(null);
          setClients((prev) => {
            const rest = (prev ?? []).filter((c) => c.id !== client.id);
            return [...rest, client].sort((a, b) => a.name.localeCompare(b.name));
          });
          setExpanded(client.id);
        }}
      />

      {clients === null ? (
        <p className="clients__note" role="status">
          Loading…
        </p>
      ) : clients.length === 0 ? (
        <p className="clients__note" role="status">
          No clients onboarded yet — every run still works under the free-text client id on the composer; onboard one
          here only once you also want its changes pushed to a real repo.
        </p>
      ) : (
        <ul className="clients__list">
          {clients.map((client) => (
            <li key={client.id} className="clients__row">
              <button
                type="button"
                className="clients__item"
                aria-expanded={expanded === client.id}
                onClick={() => setExpanded((cur) => (cur === client.id ? null : client.id))}
              >
                <span className="clients__name">{client.name}</span>
                <code className="clients__id">{client.id}</code>
                <span className="clients__repo-status" data-tone={repoTone(client)}>
                  {repoLabel(client)}
                </span>
              </button>
              {expanded === client.id && (
                <>
                  <RepoForm
                    client={client}
                    onLinked={(updated) => {
                      setClients((prev) => (prev ?? []).map((c) => (c.id === updated.id ? updated : c)));
                    }}
                  />
                  {/* Only meaningful once there is a repo to push to — an
                      unlinked client's changes stay local and need no gate. */}
                  {client.repo && <Reviews clientId={client.id} />}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function repoTone(client: ClientRecord): "ok" | "warn" | undefined {
  if (!client.repo) return undefined;
  return client.repo.lastSyncError ? "warn" : "ok";
}

function repoLabel(client: ClientRecord): string {
  if (!client.repo) return "no repo linked";
  if (client.repo.lastSyncError) return "last sync failed";
  if (client.repo.lastSyncedAt) return "synced";
  return "linked";
}

function OnboardForm({ onOnboarded }: { onOnboarded: (client: ClientRecord) => void }) {
  const ids = { id: useId(), name: useId() };
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const client = await onboardClient(id.trim(), name.trim() || id.trim());
      onOnboarded(client);
      setId("");
      setName("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not onboard that client.");
    } finally {
      setBusy(false);
    }
  }, [id, name, onOnboarded]);

  return (
    <form
      className="clients__onboard"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="field">
        <label className="field__label" htmlFor={ids.id}>
          Client id
        </label>
        <input
          id={ids.id}
          className="input"
          value={id}
          onChange={(e) => setId(e.target.value)}
          placeholder="acme"
          pattern="[a-z0-9][a-z0-9-]*"
          spellCheck={false}
          disabled={busy}
          required
        />
      </div>
      <div className="field">
        <label className="field__label" htmlFor={ids.name}>
          Name
        </label>
        <input
          id={ids.name}
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Acme Corp"
          disabled={busy}
        />
      </div>
      {error && <p className="field__error">{error}</p>}
      <button className="btn" type="submit" disabled={busy || !id.trim()}>
        {busy ? "Onboarding…" : "Onboard client"}
      </button>
    </form>
  );
}

function RepoForm({ client, onLinked }: { client: ClientRecord; onLinked: (client: ClientRecord) => void }) {
  const ids = { url: useId(), branch: useId(), tokenVar: useId() };
  const suggestedVar = `TESTLAB_REPO_TOKEN_${client.id.toUpperCase().replace(/-/g, "_")}`;
  const [url, setUrl] = useState(client.repo?.url ?? "");
  const [baseBranch, setBaseBranch] = useState(client.repo?.baseBranch ?? "main");
  const [tokenEnvVar, setTokenEnvVar] = useState(client.repo?.tokenEnvVar ?? suggestedVar);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const updated = await linkClientRepo(client.id, { url: url.trim(), baseBranch: baseBranch.trim(), tokenEnvVar: tokenEnvVar.trim() });
      onLinked(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not link that repo.");
    } finally {
      setBusy(false);
    }
  }, [baseBranch, client.id, onLinked, tokenEnvVar, url]);

  return (
    <form
      className="clients__repo-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="field">
        <label className="field__label" htmlFor={ids.url}>
          Repo URL
        </label>
        <input
          id={ids.url}
          className="input"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://github.com/acme/qa-suite.git"
          spellCheck={false}
          disabled={busy}
          required
        />
      </div>
      <div className="field">
        <label className="field__label" htmlFor={ids.branch}>
          Base branch
        </label>
        <input
          id={ids.branch}
          className="input"
          value={baseBranch}
          onChange={(e) => setBaseBranch(e.target.value)}
          spellCheck={false}
          disabled={busy}
        />
      </div>
      <div className="field">
        <label className="field__label" htmlFor={ids.tokenVar}>
          Access-token env var
        </label>
        <input
          id={ids.tokenVar}
          className="input"
          value={tokenEnvVar}
          onChange={(e) => setTokenEnvVar(e.target.value.toUpperCase())}
          spellCheck={false}
          disabled={busy}
        />
        <p className="field__hint">
          Not the token itself — the name of an env var set on this server holding it. Set{" "}
          <code>{tokenEnvVar || suggestedVar}</code> to a repo access token before linking.
        </p>
      </div>
      {error && <p className="field__error">{error}</p>}
      {client.repo?.lastSyncedAt && !error && (
        <p className="field__hint">
          Last synced {new Date(client.repo.lastSyncedAt).toLocaleString()}
          {client.repo.lastSyncError ? ` — ${client.repo.lastSyncError}` : ""}
        </p>
      )}
      <button className="btn" type="submit" disabled={busy || !url.trim()}>
        {busy ? "Linking…" : client.repo ? "Update link" : "Link repo"}
      </button>
      <p className="field__hint">
        Generated changes land on a rolling <code>testlab-updates</code> branch, never pushed straight to{" "}
        {baseBranch || "the base branch"} — open a PR from it whenever you're ready to review.
      </p>
    </form>
  );
}
