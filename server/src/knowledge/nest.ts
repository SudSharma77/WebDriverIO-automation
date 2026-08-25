import { balanced } from "./structure.js";

/**
 * Fold a freshly-synthesized single-scenario spec into an already-saved spec
 * for the same page, as a sibling `it()` inside its existing `describe(...)`,
 * instead of either overwriting it or minting yet another near-duplicate file.
 *
 * Synth always emits the same predictable shape — one `@testlab/framework`
 * import, one `describe()` wrapping one `it()` — so this is a deterministic
 * splice, not a model call: cheaper, and it cannot paraphrase or drop a line
 * the way asking an LLM to "reproduce this file exactly, then add to it"
 * risks (the extend-a-running-scenario flow already accepts that risk for a
 * smaller edit; minting whole new scenarios happens far more often, so it is
 * worth avoiding here).
 *
 * Returns null when either file isn't shaped the way synth emits it — the
 * caller's job is to fall back to a separate file in that case, never to
 * guess at a splice that might corrupt or silently drop the existing scenario.
 */
export function nestScenario(existing: string, addition: string): string | null {
  const newIt = extractSoleIt(addition);
  const insertAt = findInsertionPoint(existing);
  if (!newIt || insertAt === null) return null;

  // No re-indenting needed: synth always writes `it(` as a direct child of
  // `describe(` at the same depth, so the extracted block already carries the
  // right indentation for landing as a sibling of the existing one.
  const spliced = existing.slice(0, insertAt) + "\n\n  " + newIt + "\n" + existing.slice(insertAt);
  return mergeFrameworkImport(spliced, addition);
}

/** The full `it('...', async () => { ... });` block, exactly as synth wrote it. */
function extractSoleIt(source: string): string | null {
  const match = /\bit\s*\(/.exec(source);
  if (!match) return null;

  const parenIndex = match.index + match[0].length - 1;
  const args = balanced(source, parenIndex);
  if (args === null) return null;

  let end = parenIndex + 1 + args.length + 1; // +1 past the matching `)`
  if (source[end] === ";") end += 1;

  return source.slice(match.index, end).trim();
}

/**
 * Index just before the closing `}` of the outer `describe(...)`'s arrow
 * function body — where a new sibling `it()` belongs. Null if the file
 * doesn't have exactly the one-describe shape synth always produces, so the
 * caller knows to fall back rather than splice into the wrong place.
 */
function findInsertionPoint(source: string): number | null {
  const match = /\bdescribe\s*\(/.exec(source);
  if (!match) return null;

  const parenIndex = match.index + match[0].length - 1;
  const args = balanced(source, parenIndex);
  if (args === null) return null;

  // The describe's own closing `)` sits right after its args; walking back
  // from there past whitespace should land on the arrow body's closing `}`.
  const closingParen = parenIndex + 1 + args.length;
  let i = closingParen - 1;
  while (i >= 0 && /\s/.test(source[i]!)) i -= 1;

  return source[i] === "}" ? i : null;
}

/**
 * Union the two files' `@testlab/framework` import lists — the new scenario
 * may lean on a helper (e.g. `dismissIfPresent`) the first one never needed.
 *
 * An absent import on either side is a normal state, not a malformed file, and
 * must not fail the nest. A thoroughly rewritten spec can legitimately have no
 * framework import left at all: once navigation became `page.open()` and every
 * labelled call became a page-object method, there is nothing left to import.
 * Declining there would push every later scenario for that page into its own
 * `-2` file and quietly undo the grouping `categoryFile` exists to produce.
 */
function mergeFrameworkImport(spliced: string, addition: string): string {
  const IMPORT = /import\s*\{([^}]*)\}\s*from\s*['"]@testlab\/framework['"];?/;

  const additionMatch = IMPORT.exec(addition);
  if (!additionMatch) return spliced; // Nothing to merge in.

  const existingMatch = IMPORT.exec(spliced);
  if (!existingMatch) {
    // Above the local page imports, which is where synth puts it too.
    return `import { ${splitNames(additionMatch[1]!).sort().join(", ")} } from '@testlab/framework';\n${spliced}`;
  }

  const names = new Set([...splitNames(existingMatch[1]!), ...splitNames(additionMatch[1]!)]);
  const merged = [...names].sort().join(", ");

  return spliced.slice(0, existingMatch.index) + `import { ${merged} } from '@testlab/framework';` + spliced.slice(existingMatch.index + existingMatch[0].length);
}

function splitNames(list: string): string[] {
  return list
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean);
}
