/**
 * Pull labelled locators out of a generated spec.
 *
 * Deterministic on purpose: this runs after every passing run, and paying for a
 * model call to read code we generated ourselves would defeat the point of
 * accumulating knowledge to save tokens.
 *
 * It reads our own helper calls, whose shape we control:
 *   click('#login', { label: 'the login button' })
 *   type('#user', creds, { label: 'the username field' })
 */

/** Helpers whose first argument is a selector. */
const HELPERS = ["click", "type", "getText", "selectOption", "isVisible", "waitForGone", "find"];

export interface ExtractedLocator {
  label: string;
  selector: string;
}

export function extractLocators(spec: string): ExtractedLocator[] {
  const found = new Map<string, string>();

  for (const call of callSites(spec)) {
    const selector = firstStringLiteral(call.args);
    const label = labelArgument(call.args);
    // A call without a label is still valid code, just not knowledge: there is
    // no stable name to file the selector under, so skip rather than invent one.
    if (selector && label && !found.has(label)) found.set(label, selector);
  }

  return [...found].map(([label, selector]) => ({ label, selector }));
}

interface CallSite {
  name: string;
  args: string;
}

/**
 * Find helper calls and return their argument text.
 *
 * Scans for balanced parentheses rather than using one regex: arguments contain
 * nested calls and object literals, and a non-greedy match stops at the first
 * `)` — which for `click($('a'), {...})` is the wrong one.
 */
function callSites(source: string): CallSite[] {
  const sites: CallSite[] = [];
  const opener = new RegExp(`\\b(${HELPERS.join("|")})\\s*\\(`, "g");

  for (let match = opener.exec(source); match; match = opener.exec(source)) {
    // `foo.click(` and `await someClick(` are other people's functions.
    const before = source[match.index - 1];
    if (before === "." || (before !== undefined && /[\w$]/.test(before))) continue;

    const args = balanced(source, opener.lastIndex - 1);
    if (args !== null) sites.push({ name: match[1]!, args });
  }

  return sites;
}

/** Text between `(` at `open` and its matching `)`, skipping strings. */
function balanced(source: string, open: number): string | null {
  let depth = 0;
  let quote: string | null = null;

  for (let i = open; i < source.length; i++) {
    const char = source[i]!;

    if (quote) {
      if (char === "\\") i++;
      else if (char === quote) quote = null;
      continue;
    }

    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }
    if (char === "(") depth++;
    else if (char === ")") {
      depth--;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return null;
}

function firstStringLiteral(args: string): string | null {
  const match = /^\s*(['"`])((?:[^\\]|\\.)*?)\1/.exec(args);
  return match?.[2] ?? null;
}

function labelArgument(args: string): string | null {
  const match = /\blabel\s*:\s*(['"`])((?:[^\\]|\\.)*?)\1/.exec(args);
  return match?.[2]?.trim() || null;
}

/** Credential names a spec reads, so a replay can demand them up front. */
export function extractRequiredSecrets(spec: string, prefix: string): string[] {
  const pattern = new RegExp(`process\\.env\\.${prefix}([A-Z][A-Z0-9_]{0,63})`, "g");
  return [...new Set([...spec.matchAll(pattern)].map((m) => m[1]!))].sort();
}
