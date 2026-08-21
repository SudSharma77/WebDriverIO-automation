/**
 * Plan a test against a framework and show the diff it would write.
 *
 *   tsx server/src/planner/cli.ts <framework> "<test case in English>" [--apply]
 *   tsx server/src/planner/cli.ts <framework> ./request.json [--apply]
 *
 * A .json argument is resolved with no model at all. Prose goes through the
 * planner, whose every reference is then validated against the real index.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { indexFramework, resolveFrameworkRoot } from "../framework/indexer.js";
import { summarizeIndex } from "../framework/render.js";
import { planFromPrompt } from "./fromPrompt.js";
import { resolvePlan } from "./resolve.js";
import { applyDiff, proposeDiff, renderDiff } from "./write.js";
import type { TestPlan, TestRequest } from "./types.js";

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const positional = args.filter((a) => !a.startsWith("--"));

const frameworkArg = positional[0];
// npm strips quotes when forwarding script arguments, so a prose test case
// arrives as many argv entries. Rejoin them rather than making the caller
// fight their shell's quoting rules.
const inputArg = positional.slice(1).join(" ").trim();

if (!frameworkArg || !inputArg) {
  console.error('usage: tsx server/src/planner/cli.ts <framework> "<test case>" | <request.json> [--apply] [--mobile]');
  process.exit(1);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");

const root = await resolveFrameworkRoot(frameworkArg, [process.cwd(), repoRoot]);
const index = await indexFramework(root);
const platform = flags.has("--mobile") ? "mobile" : "web";

console.log(`framework: ${index.root}`);
console.log(`inventory: ${summarizeIndex(index)}\n`);

let plan: TestPlan;

if (inputArg.toLowerCase().endsWith(".json")) {
  const request = JSON.parse(await fs.readFile(path.resolve(process.cwd(), inputArg), "utf8")) as TestRequest;
  plan = resolvePlan(index, request);
  console.log("mode: deterministic (no model called)\n");
} else {
  const result = await planFromPrompt(index, inputArg, platform);
  plan = result.plan;
  console.log(`mode: prompt (${result.llmCalls} model call${result.llmCalls === 1 ? "" : "s"})`);

  if (result.duplicateOf) {
    console.log(`\n⚠ ALREADY COVERED by an existing spec: "${result.duplicateOf}"`);
  }
  if (result.missing.length > 0) {
    console.log("\nNEEDS CREATING — not in the framework today:");
    for (const gap of result.missing) {
      const suggestion = gap.suggestedClass ? ` (suggest ${gap.suggestedClass}.${gap.suggestedMethod ?? "…"})` : "";
      console.log(`  + ${gap.capability}${suggestion}`);
    }
  }
  console.log("");
}

const diff = await proposeDiff(index, plan);
console.log(renderDiff(diff));

if (!plan.complete) {
  console.log("\nPlan is incomplete — nothing written.");
  process.exit(2);
}

if (flags.has("--apply")) {
  console.log(`\napplied: ${(await applyDiff(diff)).join(", ")}`);
} else {
  console.log("\n(dry run — pass --apply to write these files)");
}
