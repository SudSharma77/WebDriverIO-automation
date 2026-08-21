import { ESLint, type Linter } from "eslint";
import { configs as wdioConfig } from "eslint-plugin-wdio";

export interface LintResult {
  code: string;
  /** Errors ESLint could not auto-fix - real issues worth surfacing, e.g. a missing `await` before `expect(...)`. */
  issues: string[];
}

/**
 * Deterministic quality gate on top of the prompt-based rules in prompts.ts.
 *
 * A model can silently ignore a prose instruction; it can't silently pass a
 * lint rule. wdio/await-expect in particular catches a real correctness bug a
 * prompt can't reliably prevent on its own: `expect(el).toBeDisplayed()`
 * without `await` returns a pending promise that is never checked - the test
 * "passes" without actually asserting anything.
 */
export async function lintSpec(code: string): Promise<LintResult> {
  const eslint = new ESLint({
    cwd: process.cwd(),
    overrideConfigFile: true,
    overrideConfig: [
      {
        languageOptions: { ecmaVersion: "latest", sourceType: "script" },
      },
      // eslint-plugin-wdio ships its own looser config typing than ESLint's
      // Config<RulesConfig> expects (plain `string` rule severities); the
      // shape is correct at runtime, as proven by lintSpec's own tests.
      wdioConfig["flat/recommended"] as Linter.Config,
    ],
    fix: true,
  });

  const [result] = await eslint.lintText(code, { filePath: "generated.e2e.js" });
  if (!result) return { code, issues: [] };

  const fixedCode = result.output ?? code;
  const issues = result.messages
    .filter((m) => m.severity === 2)
    .map((m) => `${m.ruleId ?? "eslint"}: ${m.message} (line ${m.line})`);

  return { code: fixedCode, issues };
}
