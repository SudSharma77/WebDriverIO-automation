/**
 * Inspect how the tool sees a framework.
 *
 *   tsx server/src/framework/cli.ts <path> [--prompt] [--write-config]
 *
 * --prompt        print the exact block sent to the planner, with its token cost
 * --write-config  save the detected layout as testlab.config.json in the target
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { detectLayout, writeConfigFile } from "./detect.js";
import { indexFramework, resolveFrameworkRoot } from "./indexer.js";
import { renderIndex, summarizeIndex } from "./render.js";

const target = process.argv[2];
if (!target) {
  console.error("usage: tsx server/src/framework/cli.ts <path-to-framework> [--prompt] [--write-config]");
  process.exit(1);
}

// server/src/framework -> server/src -> server -> repo root
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");

// `npm run --workspace server` runs from server/, so a path typed relative to
// the repo root would otherwise miss. Try both.
const root = await resolveFrameworkRoot(target, [process.cwd(), repoRoot]);
const layout = await detectLayout(root);
const index = await indexFramework(root, { layout });

if (process.argv.includes("--write-config")) {
  const file = await writeConfigFile(layout);
  console.log(`wrote ${file}`);
}

if (process.argv.includes("--prompt")) {
  const block = renderIndex(index, { platform: "web" });
  console.log(block);
  console.log(`\n[${block.length} chars, ~${Math.round(block.length / 3.6)} tokens]`);
} else {
  console.log(`root: ${index.root}`);
  console.log(`summary: ${summarizeIndex(index)}`);

  console.log("\n── detected layout ──");
  const mark = (key: string) => `(${layout.confidence[key] ?? "guessed"})`;
  console.log(`  language        ${layout.language} ${mark("language")}`);
  console.log(`  testFramework   ${layout.testFramework} ${mark("testFramework")}`);
  console.log(`  pageObjectDirs  ${layout.pageObjectDirs.join(", ") || "-"} ${mark("pageObjectDirs")}`);
  console.log(`  utilityDirs     ${layout.utilityDirs.join(", ") || "-"} ${mark("utilityDirs")}`);
  console.log(`  specsDir        ${layout.specsDir ?? "-"} ${mark("specsDir")}`);
  console.log(`  dataDirs        ${layout.dataDirs.join(", ") || "-"} ${mark("dataDirs")}`);
  console.log(`  stepDefDirs     ${layout.stepDefinitionDirs.join(", ") || "-"}`);
  console.log(`  baseClass       ${layout.baseClass ?? "-"} ${mark("baseClass")}`);
  console.log(`  aliases         ${JSON.stringify(layout.aliases)}`);
  console.log(`  exemplars       page=${layout.exemplars.pageObject ?? "-"}  spec=${layout.exemplars.spec ?? "-"}`);

  console.log("\n── page objects ──");
  for (const page of index.pageObjects) {
    console.log(`  ${page.className} [${page.platform}] ${page.file} -> ${page.importPath}`);
    for (const method of page.methods) {
      console.log(`     · ${method.name}(${method.params.map((p) => p.name).join(", ")}): ${method.returnType}`);
    }
    for (const element of page.elements) {
      console.log(`     ~ ${element.name} = ${element.multiple ? "$$" : "$"}('${element.selector ?? "?"}')`);
    }
  }
  if (index.pageObjects.length === 0) console.log("  (none)");

  console.log(`\n── base class: ${index.baseClass?.className ?? "(none)"} ──`);
  for (const helper of index.baseClass?.helpers ?? []) console.log(`  ${helper}`);

  console.log("\n── helpers ──");
  for (const helper of index.helpers) {
    console.log(`  ${helper.className} (${helper.methods.length}) -> ${helper.importPath}`);
  }
  if (index.helpers.length === 0) console.log("  (none)");

  if (index.stepDefinitions.length > 0) {
    console.log("\n── step definitions ──");
    for (const step of index.stepDefinitions) console.log(`  ${step.keyword} ${step.pattern}  [${step.file}]`);
  }

  console.log("\n── data ──");
  for (const file of index.data) {
    console.log(`  ${file.name} (${file.format}, ${file.recordCount}) ${file.fields.slice(0, 8).join(", ")}`);
  }
  if (index.data.length === 0) console.log("  (none)");

  console.log("\n── wdio configs ──");
  for (const config of index.configs) {
    console.log(`  ${config.platform}: specs=${JSON.stringify(config.specs)} baseUrl=${config.baseUrl ?? "-"}`);
  }

  console.log("\n── specs ──");
  for (const spec of index.specs) console.log(`  ${spec.file} (${spec.suites.length} suites)`);
  if (index.specs.length === 0) console.log("  (none)");

  console.log("\n── warnings ──");
  for (const warning of index.warnings) console.log(`  ! ${warning}`);
  if (index.warnings.length === 0) console.log("  (none)");
}
