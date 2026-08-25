import { HELPER_INTERACTION, balanced, methodsFor, type Interaction, type PageFact } from "./structure.js";

export interface RewriteResult {
  code: string;
  /** Page classes the rewritten spec now imports and calls. */
  pagesUsed: PageFact[];
}

/**
 * Replace raw `click('sel', {label:'X'})`-shaped calls with the matching
 * page-object method — `await loginPage.clickX()` — so a saved spec reads
 * scenario steps and test data, not selectors.
 *
 * Purely mechanical, not a model call: every page-object method is a
 * one-line wrapper around the identical underlying helper call (see
 * `codegen.ts`), so a correct substitution is behaviourally identical at
 * runtime — same selector, same wait, same label in the failure message.
 *
 * A masked credential field rewrites like any other. It used to be refused,
 * because the generated method had no way to carry `{ mask: true }` and
 * dropping it would have put a password back into WebdriverIO's own command
 * log — so the password field stayed as a raw selector in the spec forever.
 * Masking is now a property of the *element* (`ElementFact.masked`), which
 * means the generated method carries the flag itself and the call site no
 * longer has to.
 *
 * Any call this can't confidently map — no page-object method for that
 * selector, no label — is left untouched, not guessed at. The result is always
 * valid, always at least as safe as the input; only the amount of rewriting
 * varies.
 */
export function rewriteToPageObjects(spec: string, pages: PageFact[]): RewriteResult | null {
  const bySelector = buildSelectorIndex(pages);
  const pageByInstance = new Map(pages.map((p) => [instanceName(p.className), p]));
  const pagesUsed = new Map<string, PageFact>();

  const navigated = rewriteNavigation(spec, pages);
  for (const page of navigated.pagesUsed) pagesUsed.set(instanceName(page.className), page);
  spec = navigated.code;

  const pattern = new RegExp(`\\b(${Object.keys(HELPER_INTERACTION).join("|")})\\s*\\(`, "g");
  let code = "";
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(spec))) {
    const helper = match[1]!;
    const callStart = match.index;
    const parenIndex = callStart + match[0].length - 1;

    // Guard against `page.click(` / `myClick(` — someone else's method.
    const before = spec[callStart - 1];
    if (before !== undefined && /[\w$.]/.test(before)) continue;

    const args = balanced(spec, parenIndex);
    if (args === null) return null; // Unbalanced parens: not a shape we understand at all.

    const callEnd = parenIndex + 1 + args.length + 1; // past the matching `)`
    pattern.lastIndex = callEnd;

    const replacement = replacementFor(helper, args, bySelector);
    if (!replacement) continue; // Left exactly as it was.

    pagesUsed.set(replacement.instance, pageByInstance.get(replacement.instance)!);
    code += spec.slice(cursor, callStart) + replacement.text;
    cursor = callEnd;
  }

  code += spec.slice(cursor);

  if (!balancedOverall(code)) return null; // Defensive: a position bug here must never ship a broken file.

  return { code, pagesUsed: [...pagesUsed.values()] };
}

/** `browser.url('…')`, capturing the literal so it can be matched to a page. */
const NAVIGATION = /\bbrowser\.url\(\s*(['"`])([^'"`]+)\1\s*\)/g;

/**
 * A `waitForPageLoad()` immediately after a navigation, which `open()` already
 * does for the caller and which would otherwise be left behind as a stray call
 * to an import nothing else needs.
 */
const TRAILING_PAGE_LOAD = /^;(\s*)await\s+waitForPageLoad\(\s*\)\s*;/;

/**
 * `await browser.url('https://shop.example.com/')` -> `await shopPage.open()`.
 *
 * The page object already owns the URL — `renderPage` writes an `open()` for
 * every page observed at one — so a spec repeating it is the same duplication
 * as a spec repeating a selector: when the app moves to a new domain, the
 * literal has to be found in every spec instead of in one page object.
 *
 * Only rewritten when a page was actually observed at exactly that URL. A
 * navigation to somewhere no page object covers stays as it is, because there
 * is nothing to call instead.
 */
function rewriteNavigation(spec: string, pages: PageFact[]): { code: string; pagesUsed: PageFact[] } {
  const byUrl = new Map(pages.filter((p) => p.url).map((p) => [p.url!, p]));
  if (byUrl.size === 0) return { code: spec, pagesUsed: [] };

  const used = new Map<string, PageFact>();
  let code = "";
  let cursor = 0;

  NAVIGATION.lastIndex = 0;
  for (let match = NAVIGATION.exec(spec); match; match = NAVIGATION.exec(spec)) {
    const page = byUrl.get(match[2]!);
    if (!page) continue;

    let end = match.index + match[0].length;
    // Swallow the redundant wait, keeping the statement's own semicolon so the
    // surrounding indentation and line structure survive untouched.
    const after = TRAILING_PAGE_LOAD.exec(spec.slice(end));
    if (after) end += after[0].length - 1;

    used.set(page.className, page);
    code += spec.slice(cursor, match.index) + `${instanceName(page.className)}.open()`;
    cursor = end;
    NAVIGATION.lastIndex = end;
  }

  return { code: code + spec.slice(cursor), pagesUsed: [...used.values()] };
}

function replacementFor(
  helper: string,
  args: string,
  bySelector: Map<string, Map<Interaction, { instance: string; method: string }>>,
): { instance: string; method: string; text: string } | null {
  const parts = splitArgs(args);
  const selector = firstStringLiteral(parts[0] ?? "");
  const label = labelArgument(args);
  if (!selector || !label) return null;

  const interaction = HELPER_INTERACTION[helper]!;
  const mapped = bySelector.get(selector)?.get(interaction);
  if (!mapped) return null;

  const value = interaction === "type" ? (parts[1] ?? "") : "";
  return { ...mapped, text: `${mapped.instance}.${mapped.method}(${value})` };
}

/** `{ selector: { interaction: { instance, method } } }`, from every element every page knows about. */
function buildSelectorIndex(pages: PageFact[]): Map<string, Map<Interaction, { instance: string; method: string }>> {
  const index = new Map<string, Map<Interaction, { instance: string; method: string }>>();

  for (const page of pages) {
    const instance = instanceName(page.className);
    for (const element of page.elements) {
      let forSelector = index.get(element.selector);
      if (!forSelector) {
        forSelector = new Map();
        index.set(element.selector, forSelector);
      }
      for (const { name, interaction } of methodsFor(element)) {
        forSelector.set(interaction, { instance, method: name });
      }
    }
  }

  return index;
}

/**
 * Top-level comma-separated argument segments — depth-aware across
 * `()`/`[]`/`{}` and quote-skipping, so `{ label: 'a, b' }` or a nested call
 * in an argument doesn't get mistaken for an argument boundary.
 */
function splitArgs(args: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;

  for (let i = 0; i < args.length; i++) {
    const char = args[i]!;
    if (quote) {
      if (char === "\\") i += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }
    if (char === "(" || char === "[" || char === "{") depth += 1;
    else if (char === ")" || char === "]" || char === "}") depth -= 1;
    else if (char === "," && depth === 0) {
      parts.push(args.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(args.slice(start).trim());
  return parts;
}

function firstStringLiteral(text: string): string | null {
  return /^\s*(['"`])((?:[^\\]|\\.)*?)\1\s*$/.exec(text)?.[2] ?? null;
}

function labelArgument(args: string): string | null {
  return /\blabel\s*:\s*(['"`])((?:[^\\]|\\.)*?)\1/.exec(args)?.[2]?.trim() || null;
}

function balancedOverall(code: string): boolean {
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < code.length; i++) {
    const char = code[i]!;
    if (quote) {
      if (char === "\\") i += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }
    if (char === "(" || char === "[" || char === "{") depth += 1;
    else if (char === ")" || char === "]" || char === "}") depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0 && quote === null;
}

/**
 * Where a rewritten spec imports a page object from.
 *
 * Fixed by the project layout: `test/specs/*.spec.js` importing
 * `src/pages/*.js` is always two levels up and back down, regardless of
 * which spec or page — the same depth `renderPage`/`renderFlow` already
 * assume elsewhere.
 */
export function pageImport(page: PageFact): string {
  return `import { ${instanceName(page.className)} } from '../../src/pages/${page.className}.js';`;
}

const FRAMEWORK_IMPORT = /import\s*\{([^}]*)\}\s*from\s*['"]@testlab\/framework['"];?\n?/;

/**
 * Drop any `@testlab/framework` helper the rewrite left with no remaining
 * call, and add one import per page object the rewrite now calls into that
 * the file doesn't already import.
 *
 * A helper import surviving unused isn't wrong, just untidy — `waitForGone`
 * imported for a step that got fully rewritten into a page-object method is
 * exactly the kind of dead import a linter flags on the client's first CI
 * run, so it's worth pruning here rather than leaving it as their problem.
 *
 * The dedupe matters once a spec has been rewritten more than once: nesting
 * a second scenario in re-introduces that scenario's own raw calls, which
 * this rewrite step turns back into page-object calls on every save — a page
 * already imported for the first scenario would otherwise gain a second,
 * identical import line on every subsequent one.
 */
export function finalizeImports(code: string, pagesUsed: PageFact[]): string {
  const match = FRAMEWORK_IMPORT.exec(code);
  if (!match) return code; // Not the shape synth always writes; leave untouched.

  const rest = code.slice(0, match.index) + code.slice(match.index + match[0].length);
  const names = (match[1] ?? "").split(",").map((n) => n.trim()).filter(Boolean);
  const stillUsed = names.filter((name) => {
    // An inline type-only specifier (`type TypeOptions`) is used in an
    // annotation, never in a call, so a call-site scan can only ever conclude
    // it is dead and delete it. Keeping it is the safe answer: an unused type
    // import is untidy, a missing one stops the file type-checking. Note the
    // helper genuinely named `type` is a different thing and is not matched
    // here — it has no space after it.
    if (/^type\s+\S/.test(name)) return true;
    return new RegExp(`\\b${escapeRegExp(name)}\\s*\\(`).test(rest);
  });

  const newPages = pagesUsed.filter((p) => !hasPageImport(code, p));

  const frameworkLine = stillUsed.length > 0 ? `import { ${stillUsed.join(", ")} } from '@testlab/framework';\n` : "";
  const pageLines = newPages.map((p) => pageImport(p)).join("\n");
  const pageBlock = pageLines ? `${pageLines}\n` : "";

  return code.slice(0, match.index) + frameworkLine + pageBlock + code.slice(match.index + match[0].length);
}

function hasPageImport(code: string, page: PageFact): boolean {
  return new RegExp(`from\\s*['"]\\.\\./\\.\\./src/pages/${escapeRegExp(page.className)}\\.js['"]`).test(code);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function instanceName(className: string): string {
  return className[0]!.toLowerCase() + className.slice(1);
}
