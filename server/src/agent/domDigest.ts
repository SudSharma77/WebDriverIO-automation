/**
 * Reduce a captured page to the part a repair pass can act on.
 *
 * Handing the model `html.slice(0, 4000)` sounds reasonable and is almost
 * always useless: a real page opens with a few hundred lines of meta tags,
 * preload links and inline scripts, so the slice ends before `<body>` and the
 * model is shown Open Graph tags instead of the screen. Measured on a real
 * failure here: 28 meta, 10 link, 7 script, 0 body elements.
 *
 * So this strips what cannot contain a selector, then keeps the elements a
 * test would actually target.
 */

/** Elements that never hold a user-visible, selectable target. */
const DROP_WHOLE = /<(script|style|noscript|svg|template|iframe)\b[^>]*>[\s\S]*?<\/\1>/gi;
const DROP_HEAD = /<head\b[^>]*>[\s\S]*?<\/head>/i;
const DROP_COMMENTS = /<!--[\s\S]*?-->/g;

/** Attributes worth keeping: the ones selectors are actually written against. */
const KEEP_ATTRS = new Set(["id", "name", "type", "role", "href", "value", "placeholder", "title", "alt", "for"]);

export interface DomDigestOptions {
  /** Character budget for the result. */
  maxChars?: number;
}

/**
 * A compact, selector-oriented view of the page.
 *
 * Two sections, because they answer different questions: the headings say
 * "which screen am I on", and the interactive elements say "what could the
 * failing step have targeted instead".
 */
export function digestDom(html: string, options: DomDigestOptions = {}): string {
  const { maxChars = 4000 } = options;

  const body = stripToBody(html);
  const sections: string[] = [];

  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim();
  if (title) sections.push(`Page title: ${decode(title)}`);

  const headings = collect(body, /<(h[1-6])\b[^>]*>([\s\S]*?)<\/\1>/gi, (m) => {
    const text = textOf(m[2] ?? "");
    return text ? `  <${m[1]!.toLowerCase()}> ${text}` : null;
  });
  if (headings.length > 0) sections.push(`Headings actually on the page:\n${headings.join("\n")}`);

  const interactive = collect(
    body,
    /<(button|a|input|select|textarea)\b([^>]*)>(?:([\s\S]*?)<\/\1>)?/gi,
    (m) => {
      const tag = m[1]!.toLowerCase();
      const attrs = pickAttrs(m[2] ?? "");
      const text = textOf(m[3] ?? "");
      if (!attrs && !text) return null;
      return `  <${tag}${attrs}>${text ? ` ${text}` : ""}`;
    },
  );
  if (interactive.length > 0) {
    sections.push(`Interactive elements actually on the page:\n${interactive.join("\n")}`);
  }

  const digest = sections.join("\n\n");
  return digest.length > maxChars ? `${digest.slice(0, maxChars)}\n… (truncated)` : digest;
}

function stripToBody(html: string): string {
  const withoutNoise = html.replace(DROP_COMMENTS, "").replace(DROP_WHOLE, "").replace(DROP_HEAD, "");
  return /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(withoutNoise)?.[1] ?? withoutNoise;
}

/** Deduplicated matches, capped — a catalogue page has hundreds of near-clones. */
function collect(source: string, pattern: RegExp, render: (m: RegExpExecArray) => string | null): string[] {
  const seen = new Set<string>();
  for (let m = pattern.exec(source); m && seen.size < 40; m = pattern.exec(source)) {
    const line = render(m);
    if (line) seen.add(line);
  }
  return [...seen];
}

function pickAttrs(raw: string): string {
  const kept: string[] = [];
  const pattern = /([a-zA-Z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

  for (let m = pattern.exec(raw); m; m = pattern.exec(raw)) {
    const name = m[1]!.toLowerCase();
    const value = m[2] ?? m[3] ?? "";
    // data-* is where test ids live, so it is kept wholesale rather than listed.
    if (!KEEP_ATTRS.has(name) && !name.startsWith("data-") && !name.startsWith("aria-")) continue;
    if (!value) continue;
    kept.push(` ${name}="${value.length > 60 ? `${value.slice(0, 60)}…` : value}"`);
  }

  return kept.join("");
}

function textOf(html: string): string {
  return decode(html.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

function decode(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}
