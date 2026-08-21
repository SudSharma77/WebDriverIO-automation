/**
 * Per-run credential handling.
 *
 * A client's app is almost always behind a login, so the orchestrator has to
 * accept credentials per request. The constraint that shapes everything here is
 * that a secret must reach the *device* without reaching any of the four places
 * it would leak from:
 *
 *   1. the model         — prompts and transcripts are sent to a third party
 *   2. the browser       — RunState is streamed wholesale over SSE
 *   3. the spec file     — it is downloadable and meant to be committed
 *   4. the run log       — replay output is captured and shown verbatim
 *
 * The mechanism is a placeholder. The model only ever sees `{{PASSWORD}}`, and
 * substitution happens at the last possible moment: in the MCP tool arguments
 * during exploration, and in the runner's environment during replay.
 */

/** Secret names are env-var shaped so they can be passed through to the runner. */
const NAME = /^[A-Z][A-Z0-9_]{0,63}$/;

const PLACEHOLDER = /\{\{([A-Z][A-Z0-9_]{0,63})\}\}/g;

/** Prefix for the environment variables handed to the wdio runner. */
export const SECRET_ENV_PREFIX = "TESTLAB_SECRET_";

export class SecretBag {
  readonly #values: Map<string, string>;

  private constructor(values: Map<string, string>) {
    this.#values = values;
  }

  static from(input: Record<string, string> | undefined): SecretBag {
    const values = new Map<string, string>();
    for (const [key, value] of Object.entries(input ?? {})) {
      // Reject rather than silently drop: a typo'd name would otherwise show up
      // as the literal text "{{PASSWROD}}" typed into a login form, which is a
      // baffling failure to debug from a screenshot.
      if (!NAME.test(key)) throw new Error(`"${key}" is not a valid secret name. Use A–Z, 0–9 and _, starting with a letter.`);
      if (value.length === 0) continue;
      values.set(key, value);
    }
    return new SecretBag(values);
  }

  get names(): string[] {
    return [...this.#values.keys()].sort();
  }

  get isEmpty(): boolean {
    return this.#values.size === 0;
  }

  /**
   * Replace `{{NAME}}` with the real value throughout a tool-call argument tree.
   *
   * Called on the way out to the MCP server, so the value exists in memory for
   * exactly as long as the tool call takes. Unknown placeholders are left alone
   * — better to type a visible `{{FOO}}` into a field and fail loudly than to
   * silently send an empty string and get a confusing validation error.
   */
  fill<T>(input: T): T {
    if (typeof input === "string") {
      return input.replace(PLACEHOLDER, (whole, name: string) => this.#values.get(name) ?? whole) as T;
    }
    if (Array.isArray(input)) return input.map((item) => this.fill(item)) as T;
    if (input && typeof input === "object") {
      const out: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(input)) out[key] = this.fill(value);
      return out as T;
    }
    return input;
  }

  /**
   * Turn any leaked secret value back into its placeholder.
   *
   * Applied to everything that flows outward — transcripts, tool summaries,
   * replay logs. The agent can echo a field's contents back in a `get_elements`
   * response without either of us intending it, and that response goes to the
   * model and to the browser.
   */
  redact(text: string): string {
    // Longest value first: if one secret is a substring of another (a password
    // that happens to contain the username, say), replacing the short one first
    // would carve up the long one and leave a fragment of it exposed.
    const byLength = [...this.#values].sort((a, b) => b[1].length - a[1].length);

    let out = text;
    for (const [name, value] of byLength) out = out.split(value).join(`{{${name}}}`);
    return out;
  }

  /** Environment for the wdio child process during replay. */
  runnerEnv(): Record<string, string> {
    const env: Record<string, string> = {};
    for (const [name, value] of this.#values) env[`${SECRET_ENV_PREFIX}${name}`] = value;
    return env;
  }

  /** How the placeholders are described to the model. Values never appear. */
  briefing(): string {
    if (this.isEmpty) return "";
    return [
      "Credentials are available for this run. When a step needs one, type the placeholder EXACTLY as written below —",
      "it is substituted with the real value before it reaches the device, and you will never see the value itself.",
      "",
      ...this.names.map((name) => `  {{${name}}}`),
      "",
      "Never invent a credential that is not in this list, and never guess at what a value might be.",
    ].join("\n");
  }
}

/** Matches a single-, double- or backtick-quoted JS string literal. */
const QUOTED = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;

const envRead = (name: string) => `process.env.${SECRET_ENV_PREFIX}${name}`;

/**
 * Rewrite placeholders in generated code as environment reads.
 *
 * Done mechanically rather than by asking the model for the env var name: the
 * spec is the artifact the client keeps, so it must contain no secret, and a
 * model that gets the variable name subtly wrong produces a spec that fails at
 * replay with `undefined` typed into a password field.
 *
 * The rewrite works on whole string literals, not on the bare placeholder text.
 * Replacing just the inner text turns `setValue('{{PASSWORD}}')` into
 * `setValue('process.env.…')` — a string containing that source, which the test
 * then dutifully types into the password field.
 */
export function bindSecretsInSpec(spec: string): string {
  return spec.replace(QUOTED, (whole, single?: string, double?: string, backtick?: string) => {
    const content = single ?? double ?? backtick;
    if (content === undefined || !content.includes("{{")) return whole;

    PLACEHOLDER.lastIndex = 0;
    const only = /^\{\{([A-Z][A-Z0-9_]{0,63})\}\}$/.exec(content);
    if (only?.[1]) return envRead(only[1]);

    // Placeholder embedded in surrounding text ('Welcome, {{USERNAME}}'). The
    // literal has to become a template for the interpolation to evaluate; a
    // quote swap alone would leave `${…}` inert inside a single-quoted string.
    if (!PLACEHOLDER.test(content)) return whole;
    PLACEHOLDER.lastIndex = 0;

    const templated = content
      .replace(/[`\\]/g, "\\$&")
      .replace(/\$\{/g, "\\${")
      .replace(PLACEHOLDER, (match, name: string) => `\${${envRead(name)}}`);
    return `\`${templated}\``;
  });
}

/**
 * The inverse, for showing an already-bound spec back to the model.
 *
 * The repair pass replays the previous spec as an assistant turn. Without this
 * the model would see `process.env.TESTLAB_SECRET_PASSWORD`, copy it into its
 * correction, and have that correction rejected by the guard that forbids the
 * model from touching the environment at all.
 */
export function unbindSecretsInSpec(spec: string): string {
  const interpolated = new RegExp(`\\$\\{process\\.env\\.${SECRET_ENV_PREFIX}([A-Z][A-Z0-9_]{0,63})\\}`, "g");
  const bare = new RegExp(`process\\.env\\.${SECRET_ENV_PREFIX}([A-Z][A-Z0-9_]{0,63})`, "g");

  return spec
    // Inside a template literal the placeholder is already in string context.
    .replace(interpolated, (_whole, name: string) => `{{${name}}}`)
    // Standalone, it occupies the position of a string literal, so it has to
    // come back quoted — the model is shown this as valid JS to correct.
    .replace(bare, (_whole, name: string) => `'{{${name}}}'`);
}

/** Placeholders left in a string, for reporting which ones a spec depends on. */
export function placeholdersIn(text: string): string[] {
  return [...new Set([...text.matchAll(PLACEHOLDER)].map((m) => m[1]!))].sort();
}
