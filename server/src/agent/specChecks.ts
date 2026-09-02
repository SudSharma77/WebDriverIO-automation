/**
 * Deterministic checks on generated spec code, applied before anything is
 * written to disk or handed to a browser.
 *
 * The same two failure classes showed up live more than once: a spec that was
 * correct except it died at load under `"type": "module"`, and a spec whose
 * only broken part was an expected value the model had invented from memory
 * rather than read from any observation. Both are cheap to detect with code
 * and expensive to discover with a replay, so they are checked here — a prose
 * rule in a prompt can be ignored; these cannot.
 */

/**
 * Rewrite CommonJS `require()` into static ESM imports.
 *
 * Specs execute inside the client project, whose package.json sets
 * `"type": "module"` — a single `require()` throws `ReferenceError` before
 * the first test step runs. Models emit `require()` often enough that the
 * prompt rule alone does not hold, and the rewrite is mechanical:
 *
 *   const { click } = require('@testlab/framework')  ->  import { click } from '@testlab/framework'
 *   const helpers = require('@testlab/framework')    ->  import helpers from '@testlab/framework'
 *   require('@testlab/framework')                    ->  import '@testlab/framework'
 */
export function ensureEsmImports(code: string): string {
  return (
    code
      .replace(
        /(?:const|let|var)\s+(\{[^}]*\}|[\w$]+)\s*=\s*require\s*\(\s*(['"])([^'"]+)\2\s*\)/g,
        (_match, binding: string, _quote: string, source: string) => `import ${binding.trim()} from '${source}'`,
      )
      // A bare require statement with no binding. Guarded by ^...$ so a call
      // embedded in a larger expression is left alone rather than corrupted.
      .replace(/^[ \t]*require\s*\(\s*(['"])([^'"]+)\1\s*\)[ \t]*;?[ \t]*$/gm, (_m, _q: string, source: string) => `import '${source}';`)
  );
}

export interface ExpectationIssue {
  /** The exact value the spec asserts but no observation contains. */
  value: string;
  matcher: string;
}

/**
 * Expected values asserted in the spec that appear nowhere in the evidence.
 *
 * `toHaveTitle('The Internet')` written for a run against iWantTFC is not a
 * loose assertion, it is a fabricated one: nothing in the plan, the transcript,
 * or the recorded session ever saw that title, so no repair of timing or
 * selectors can make it true. Every literal passed to toHaveTitle/toHaveUrl is
 * therefore required to be traceable to something observed. Matching ignores
 * case and whitespace runs, because digests reformat what they quote.
 *
 * Returns [] when there is essentially no evidence to check against (a
 * from-catalog synthesis), since absence of evidence there is expected rather
 * than suspicious.
 */
export function inventedExpectations(spec: string, evidence: string): ExpectationIssue[] {
  if (evidence.trim().length < 80) return [];

  const corpus = normalize(evidence);
  const issues = new Map<string, ExpectationIssue>();
  const pattern = /toHave(?:Title|Url)\(\s*(['"`])([^'"`\n]+)\1/g;

  for (const match of spec.matchAll(pattern)) {
    const matcher = match[0]!.slice(0, match[0]!.indexOf("("));
    const value = match[2]!.trim();
    if (value.length < 3) continue;
    if (!corpus.includes(normalize(value))) {
      issues.set(value, { value, matcher });
    }
  }

  return [...issues.values()];
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ");
}
