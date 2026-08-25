import { ESLint, type Linter } from "eslint";
import { configs as wdioConfig } from "eslint-plugin-wdio";
import * as tsParser from "@typescript-eslint/parser";
import type { ProjectLanguage } from "../knowledge/types.js";

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
export async function lintSpec(code: string, language: ProjectLanguage = "js"): Promise<LintResult> {
  const ts = language === "ts";

  const eslint = new ESLint({
    cwd: process.cwd(),
    overrideConfigFile: true,
    overrideConfig: [
      {
        languageOptions: {
          // `module`, not `script`: every generated spec opens with
          // `import { click, ... } from '@testlab/framework'`, which is a fatal
          // parse error under `script`. That failure surfaced as a phantom lint
          // issue on every synthesis, costing a wasted repair call asking the
          // model to fix code that was never broken.
          ecmaVersion: "latest",
          sourceType: "module",
          // The default parser cannot read a type annotation, and would fail a
          // TypeScript spec exactly the same way — a parse error dressed up as
          // a lint finding. No type information is requested (no `project`
          // option), so this stays a pure syntax parse: fast, and it cannot
          // fail over a missing tsconfig.
          ...(ts ? { parser: tsParser as Linter.Parser } : {}),
        },
      },
      // eslint-plugin-wdio ships its own looser config typing than ESLint's
      // Config<RulesConfig> expects (plain `string` rule severities); the
      // shape is correct at runtime, as proven by lintSpec's own tests. Its
      // rules match on AST shape, so they apply unchanged to the TS ESTree.
      wdioConfig["flat/recommended"] as Linter.Config,
    ],
    fix: true,
  });

  const [result] = await eslint.lintText(code, { filePath: ts ? "generated.e2e.ts" : "generated.e2e.js" });
  if (!result) return { code, issues: [] };

  const fixedCode = result.output ?? code;
  const issues = result.messages
    .filter((m) => m.severity === 2)
    .map((m) => `${m.ruleId ?? "eslint"}: ${m.message} (line ${m.line})`);

  return { code: fixedCode, issues };
}
