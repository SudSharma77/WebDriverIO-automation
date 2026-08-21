import fs from "node:fs/promises";
import path from "node:path";
import type { FrameworkIndex } from "../framework/types.js";
import type { FileChange, PlanStep, ProposedDiff, ResolvedCall, TestPlan } from "./types.js";

/**
 * Turn a resolved plan into a proposed diff.
 *
 * Nothing is written here — the caller decides whether to apply. That order
 * matters: the diff is where a human sees which methods were reused versus
 * created, which is the whole reason to prefer this over generating into a
 * scratch folder.
 */
export async function proposeDiff(index: FrameworkIndex, plan: TestPlan): Promise<ProposedDiff> {
  const changes: FileChange[] = [];

  if (plan.complete) {
    const relPath = path.relative(index.root, plan.specPath).split(path.sep).join("/");
    const before = await readIfExists(plan.specPath);
    changes.push({
      path: relPath,
      action: before === null ? "create" : "modify",
      before: before ?? undefined,
      after: renderSpec(index, plan),
    });
  }

  return {
    root: index.root,
    changes,
    reused: plan.reused,
    // Nothing is generated yet in the deterministic path — every step maps to
    // an existing method by construction. New methods arrive with the LLM path.
    created: [],
    problems: plan.problems,
  };
}

export async function applyDiff(diff: ProposedDiff): Promise<string[]> {
  const written: string[] = [];
  for (const change of diff.changes) {
    const abs = path.join(diff.root, change.path);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, change.after, "utf8");
    written.push(change.path);
  }
  return written;
}

/**
 * Render a spec in the target framework's conventions.
 *
 * Import style, quoting and the expect import all follow what the project
 * already does rather than a house style of ours — a JS project gets `require`,
 * a TS project gets ESM imports and the `@wdio/globals` expect it already uses.
 */
export function renderSpec(index: FrameworkIndex, plan: TestPlan): string {
  const isTs = index.layout.language === "ts";
  const cjs = !isTs && usesCommonJs(index);

  const calls = collectCalls(plan.steps);
  const imports: string[] = [];
  const setup: string[] = [];

  // Only page objects exported as a class need constructing; a module that
  // exports a ready instance must not be `new`ed.
  for (const call of calls) {
    const binding = instanceName(call);
    if (call.kind === "page" && call.exportStyle === "class" && !call.isStatic) {
      imports.push(importLine(call.className, call.importPath, call.defaultExport, cjs));
      setup.push(`    const ${binding} = new ${call.className}();`);
    } else {
      imports.push(importLine(call.className, call.importPath, call.defaultExport, cjs));
    }
  }

  if (plan.data) {
    const helper = index.helpers.find((h) => /TestData/i.test(h.className));
    if (helper) {
      imports.push(importLine(helper.className, helper.importPath, false, cjs));
      setup.unshift(
        `    const records = ${helper.className}.getInstance().loadJsonData('${plan.data.file}');`,
        `    const ${plan.data.as} = records[${plan.data.index}];`,
      );
    }
  }

  if (isTs) imports.push(`import { expect } from '@wdio/globals';`);

  const body = plan.steps.map((step) => renderStep(step)).join("\n\n");

  return [
    ...dedupe(imports),
    "",
    `describe('${escape(plan.title)}', () => {`,
    `  it('${escape(plan.test)}', async () => {`,
    ...(setup.length ? [...dedupe(setup), ""] : []),
    body,
    "  });",
    "});",
    "",
  ].join("\n");
}

/** Matchers whose signature takes nothing. */
const NO_ARGUMENT_MATCHERS = new Set(["toBeTruthy", "toBeFalsy", "toBeDisplayed"]);

function renderStep(step: PlanStep): string {
  const lines: string[] = [];
  if (step.comment) lines.push(`    // ${step.comment}`);

  const receiver = callee(step.call);
  const invocation = `${receiver}.${step.call.method}(${step.args.join(", ")})`;

  if (step.kind === "action") {
    lines.push(`    await ${invocation};`);
    return lines.join("\n");
  }

  // Some matchers take no argument. A model that supplies one anyway would
  // otherwise emit `toBeTruthy(true)`, which is wrong even though it parses.
  const value = NO_ARGUMENT_MATCHERS.has(step.matcher) ? undefined : step.value;
  const arg = value === undefined ? "" : value;

  // Element-shaped matchers assert on the element; value matchers assert on
  // whatever the method returned.
  if (step.matcher === "toBeDisplayed" || step.matcher === "toHaveText") {
    lines.push(`    await expect(await ${invocation}).${step.matcher}(${arg});`);
  } else {
    lines.push(`    expect(await ${invocation}).${step.matcher}(${arg});`);
  }
  return lines.join("\n");
}

function callee(call: ResolvedCall): string {
  if (call.isStatic || call.kind === "helper") return call.className;
  if (call.exportStyle === "instance") return call.className;
  return instanceName(call);
}

function instanceName(call: ResolvedCall): string {
  return call.className.charAt(0).toLowerCase() + call.className.slice(1);
}

function importLine(name: string, from: string, isDefault: boolean, cjs: boolean): string {
  if (cjs) return `const ${name} = require('${from}');`;
  return isDefault ? `import ${name} from '${from}';` : `import { ${name} } from '${from}';`;
}

/** Look at what the project's own files do rather than assuming. */
function usesCommonJs(index: FrameworkIndex): boolean {
  return index.pageObjects.some((p) => p.exportStyle !== "unknown" && p.file.endsWith(".js") && p.defaultExport);
}

function collectCalls(steps: PlanStep[]): ResolvedCall[] {
  const seen = new Map<string, ResolvedCall>();
  for (const step of steps) {
    if (!seen.has(step.call.className)) seen.set(step.call.className, step.call);
  }
  return [...seen.values()];
}

function dedupe(lines: string[]): string[] {
  return [...new Set(lines)];
}

function escape(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function readIfExists(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, "utf8");
  } catch {
    return null;
  }
}

/** Unified-ish rendering for the CLI and, later, the UI. */
export function renderDiff(diff: ProposedDiff): string {
  const out: string[] = [];

  if (diff.problems.length > 0) {
    out.push("UNRESOLVED — nothing will be written:");
    for (const problem of diff.problems) {
      out.push(`  ✗ ${problem.reference}: ${problem.reason}`);
      if (problem.suggestions.length > 0) {
        out.push(`      did you mean: ${problem.suggestions.slice(0, 8).join(", ")}`);
      }
    }
    out.push("");
  }

  if (diff.reused.length > 0) out.push(`REUSED (${diff.reused.length}): ${diff.reused.join(", ")}`);
  if (diff.created.length > 0) out.push(`CREATED (${diff.created.length}): ${diff.created.join(", ")}`);

  for (const change of diff.changes) {
    out.push("", `${change.action === "create" ? "+++ new file" : "~~~ modify"}  ${change.path}`, "");
    for (const line of change.after.split("\n")) out.push(`  ${line}`);
  }

  return out.join("\n");
}
