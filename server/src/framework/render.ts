import type { FrameworkIndex, HelperInfo, MethodInfo, PageObjectInfo } from "./types.js";

export interface RenderOptions {
  platform?: "web" | "mobile";
  /**
   * Approximate token ceiling for the whole block. Sections are emitted in
   * priority order and the low-value ones degrade or drop out once the budget
   * is spent — a free tier with an 8K tokens-per-minute cap cannot afford a
   * verbose framework dump plus the actual task.
   */
  budgetTokens?: number;
}

/** Rough but stable: good enough to decide what to drop, and costs nothing. */
const tokens = (text: string) => Math.round(text.length / 3.6);

/**
 * Render the index as a compact prompt block.
 *
 * Priority order is deliberate. Page objects drive the entire reuse-vs-create
 * decision, so they are never trimmed. Utility helpers and existing specs are
 * context that improves output but does not change correctness, so they are
 * what gives way when the budget is tight.
 */
export function renderIndex(index: FrameworkIndex, opts: RenderOptions = {}): string {
  const budget = opts.budgetTokens ?? 1_800;
  const sections: string[] = [];
  let spent = 0;

  const push = (text: string, essential = false): boolean => {
    const cost = tokens(text);
    if (!essential && spent + cost > budget) return false;
    sections.push(text);
    spent += cost;
    return true;
  };

  push(renderPages(index, opts.platform), true);

  if (index.baseClass) {
    push(
      [
        `## ${index.baseClass.className} — inherited by every page object`,
        "Reuse these rather than re-implementing waits or clicks:",
        ...index.baseClass.helpers.map((h) => `  this.${h}`),
      ].join("\n"),
      true,
    );
  }

  if (index.data.length > 0) {
    push(
      [
        "## Test data — load via TestDataHelper, never hardcode values",
        ...dedupeData(index).map(
          (f) => `- '${f.name}' (${f.format}, ${f.recordCount} records): ${f.fields.join(", ")}`,
        ),
      ].join("\n"),
      true,
    );
  }

  push(renderConventions(index), true);

  // Everything below is discretionary and competes for what budget remains.
  const helpers = relevantHelpers(index, opts.platform);
  if (helpers.length > 0) {
    const full = [
      "## Utility helpers available",
      ...helpers.map((h) => `- ${h.className} ('${h.importPath}'): ${methodNames(h, 10)}`),
    ].join("\n");
    if (!push(full)) {
      push(["## Utility helpers available", ...helpers.map((h) => `- ${h.className}`)].join("\n"));
    }
  }

  const coverage = renderCoverage(index);
  if (coverage) push(coverage);

  return sections.join("\n\n");
}

function renderPages(index: FrameworkIndex, platform?: "web" | "mobile"): string {
  const pages = platform
    ? index.pageObjects.filter((p) => p.platform === platform || p.platform === "shared")
    : index.pageObjects;

  if (pages.length === 0) {
    return "## Page objects\n(none for this platform — a new page object must be created)";
  }
  return ["## Page objects", ...pages.flatMap(renderPage)].join("\n");
}

function renderPage(page: PageObjectInfo): string[] {
  const lines = [`### ${page.className}  — import from '${page.importPath}'`];

  for (const method of page.methods) {
    lines.push(`  ${signature(method)}${method.doc ? `  // ${method.doc}` : ""}`);
  }
  if (page.methods.length === 0) lines.push("  (no public methods)");

  // Selectors are how the planner judges whether an existing element is the one
  // the request means — worth their tokens.
  const known = page.elements.filter((e) => e.selector).slice(0, 15);
  if (known.length > 0) {
    lines.push(`  elements: ${known.map((e) => `${e.name}=${e.multiple ? "$$" : "$"}('${e.selector}')`).join(", ")}`);
  }
  return lines;
}

function renderConventions(index: FrameworkIndex): string {
  const aliases = Object.entries(index.aliases);
  return [
    "## Conventions",
    `- Import aliases: ${aliases.length ? aliases.map(([a, t]) => `${a}/* -> ${t}/*`).join(", ") : "none"}`,
    "- Specs: TypeScript, Mocha, `import { expect } from '@wdio/globals'`",
    "- Page objects extend the base class; elements are `private get` returning $()/$$()",
  ].join("\n");
}

/** Suite titles only — enough to avoid duplicating coverage, without listing every test. */
function renderCoverage(index: FrameworkIndex): string | null {
  const titles = index.specs.flatMap((s) => s.suites.map((suite) => `- ${s.file}: ${suite.title}`));
  if (titles.length === 0) return null;
  return ["## Existing coverage — do not duplicate", ...titles.slice(0, 25)].join("\n");
}

/**
 * Drop helpers that cannot apply to this lane. A web run has no use for
 * MobileHelper or the Jira/Xray integrations, and every listed method is
 * re-billed on each planning request.
 */
function relevantHelpers(index: FrameworkIndex, platform?: "web" | "mobile"): HelperInfo[] {
  const irrelevant = /Integration$|^Api|Multiremote/;
  return index.helpers.filter((helper) => {
    if (irrelevant.test(helper.className)) return false;
    if (platform === "web" && /Mobile/.test(helper.className)) return false;
    if (platform === "mobile" && /^Web/.test(helper.className)) return false;
    return true;
  });
}

/** Names only: enough for the model to ask for a helper by name, at a tenth the cost. */
function methodNames(helper: HelperInfo, limit: number): string {
  const names = helper.methods.map((m) => m.name);
  const shown = names.slice(0, limit).join(", ");
  return names.length > limit ? `${shown}, +${names.length - limit} more` : shown;
}

/** users.json and users.csv are the same dataset; show the richer one once. */
function dedupeData(index: FrameworkIndex) {
  const best = new Map<string, (typeof index.data)[number]>();
  for (const file of index.data) {
    const existing = best.get(file.name);
    if (!existing || file.fields.length > existing.fields.length) best.set(file.name, file);
  }
  return [...best.values()];
}

function signature(method: MethodInfo): string {
  const params = method.params
    .map((p) => (p.type && p.type !== "any" ? `${p.name}${p.optional ? "?" : ""}: ${p.type}` : p.name))
    .join(", ");
  const returns = method.returnType ? `: ${method.returnType}` : "";
  return `${method.isStatic ? "static " : ""}${method.name}(${params})${returns}`;
}

/** Short human summary for the UI and logs. */
export function summarizeIndex(index: FrameworkIndex): string {
  const methodCount = index.pageObjects.reduce((n, p) => n + p.methods.length, 0);
  return [
    `${index.pageObjects.length} page objects (${methodCount} methods)`,
    `${index.helpers.length} helpers`,
    `${dedupeData(index).length} datasets`,
    `${index.specs.length} specs`,
  ].join(" · ");
}
