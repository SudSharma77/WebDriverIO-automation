interface Props {
  secrets: Array<{ name: string; value: string }>;
  onChange: (secrets: Array<{ name: string; value: string }>) => void;
  busy: boolean;
  /** Composer applies this to one run; BatchUpload applies it to every case. */
  hint: string;
}

/**
 * Pre-fill the name of a new credential row.
 *
 * Almost every login is a username and a password in that order, so filling
 * those in costs nothing and removes the moment of "wait, what do I type here?"
 * — while still being a plain editable value rather than a fixed field.
 */
function suggestName(existing: Array<{ name: string }>): string {
  const taken = new Set(existing.map((secret) => secret.name.trim().toUpperCase()));
  return ["USERNAME", "PASSWORD"].find((name) => !taken.has(name)) ?? "";
}

/**
 * Shared by the single-run composer and the bulk-upload form — a batch has
 * exactly the same credential shape as one run, just applied to every case
 * instead of one, so this has no reason to differ between them.
 */
export function Credentials({ secrets, onChange, busy, hint }: Props) {
  const update = (index: number, patch: Partial<{ name: string; value: string }>) => {
    onChange(secrets.map((secret, i) => (i === index ? { ...secret, ...patch } : secret)));
  };

  const remove = (index: number) => {
    onChange(secrets.filter((_, i) => i !== index));
  };

  const add = () => {
    onChange([...secrets, { name: suggestName(secrets), value: "" }]);
  };

  return (
    <fieldset disabled={busy}>
      <legend>Credentials</legend>
      <p className="field__hint" style={{ marginTop: 0 }}>
        {hint}
      </p>

      {secrets.length > 0 && (
        <ul className="secrets">
          <li className="secrets__row secrets__head" aria-hidden="true">
            <span>Name</span>
            <span>Value</span>
            <span />
          </li>
          {secrets.map((secret, index) => (
            <li className="secrets__row" key={index}>
              <input
                className="input secrets__name"
                value={secret.name}
                onChange={(e) => update(index, { name: e.target.value })}
                placeholder="USERNAME"
                aria-label={`Credential ${index + 1} name`}
                spellCheck={false}
              />
              <input
                className="input"
                type="password"
                value={secret.value}
                onChange={(e) => update(index, { value: e.target.value })}
                placeholder="the value itself"
                aria-label={`Credential ${index + 1} value`}
                autoComplete="off"
              />
              <button
                className="btn btn--ghost secrets__remove"
                type="button"
                onClick={() => remove(index)}
                aria-label={`Remove credential ${secret.name || index + 1}`}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <button className="btn btn--ghost" type="button" onClick={add}>
        {secrets.length === 0 ? "Add credential" : "Add another"}
      </button>
    </fieldset>
  );
}
