/**
 * Minimal JS/TS syntax highlighter for the generated spec view.
 *
 * Deliberately not a real tokenizer (no AST, no nesting rules) - a single
 * regex pass tuned for what a WebdriverIO spec actually looks like: strings,
 * comments, keywords, numbers, and WDIO's own globals. Good enough to read at
 * a glance; not meant to be correct on adversarial input, and it never has
 * to be, since the input is always model-generated JS, not user HTML.
 */
const TOKEN = new RegExp(
  [
    /\/\/.*$/.source, // line comment
    /`(?:\\.|[^`\\])*`/.source, // template string
    /'(?:\\.|[^'\\])*'/.source, // single-quoted string
    /"(?:\\.|[^"\\])*"/.source, // double-quoted string
    /\b\d+(?:\.\d+)?\b/.source, // number
    /\b(?:async|await|const|let|var|function|return|if|else|for|while|new|import|export|from|default|try|catch|finally|throw|typeof|of|in|class|extends|null|undefined|true|false)\b/
      .source,
    /\b(?:describe|it|before|after|beforeEach|afterEach|browser|expect)\b/.source,
  ].join("|"),
  "gm",
);

const KEYWORDS = new Set([
  "async",
  "await",
  "const",
  "let",
  "var",
  "function",
  "return",
  "if",
  "else",
  "for",
  "while",
  "new",
  "import",
  "export",
  "default",
  "from",
  "try",
  "catch",
  "finally",
  "throw",
  "typeof",
  "of",
  "in",
  "class",
  "extends",
  "null",
  "undefined",
  "true",
  "false",
]);

const WDIO_GLOBALS = new Set(["describe", "it", "before", "after", "beforeEach", "afterEach", "browser", "expect"]);

function classify(token: string): string {
  if (token.startsWith("//")) return "tok-comment";
  if (token.startsWith("`") || token.startsWith("'") || token.startsWith('"')) return "tok-string";
  if (/^\d/.test(token)) return "tok-number";
  if (KEYWORDS.has(token)) return "tok-keyword";
  if (WDIO_GLOBALS.has(token)) return "tok-wdio";
  return "";
}

export function highlightJs(code: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let last = 0;
  let key = 0;

  for (const match of code.matchAll(TOKEN)) {
    const index = match.index ?? 0;
    if (index > last) nodes.push(code.slice(last, index));
    const cls = classify(match[0]);
    nodes.push(
      cls ? (
        <span className={cls} key={key++}>
          {match[0]}
        </span>
      ) : (
        match[0]
      ),
    );
    last = index + match[0].length;
  }
  if (last < code.length) nodes.push(code.slice(last));
  return nodes;
}
