import fs from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import type {
  Confidence,
  FrameworkConfigFile,
  FrameworkLayout,
  Language,
  TestFramework,
} from "./types.js";

export const CONFIG_FILENAME = "testlab.config.json";

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  "coverage",
  "allure-results",
  "allure-report",
  "timeline-reports",
  "screenshots",
  "reports",
  ".next",
  ".cache",
]);

const SOURCE_EXT = /\.(ts|js|mjs|cjs)$/;
const DECLARATION = /\.d\.ts$/;
const UTILITY_DIR = /(^|\/)(utils?|utilities|helpers?|support|common|lib)\//i;

/**
 * Work out how a WebdriverIO project is organised.
 *
 * Nothing here assumes a directory name. A project's own wdio config already
 * declares where its specs are, page objects are recognisable by shape rather
 * than by living in a folder called `pageObjects`, and anything detection gets
 * wrong is overridable from a checked-in config file. That combination is what
 * lets the tool meet a framework it has never seen.
 */
export async function detectLayout(root: string): Promise<FrameworkLayout> {
  const absRoot = path.resolve(root);
  const files = await walk(absRoot);
  const rel = (p: string) => path.relative(absRoot, p).split(path.sep).join("/");

  const confidence: Record<string, Confidence> = {};
  const notes: string[] = [];

  const declared = await readConfigFile(absRoot, notes);

  const sources = files.filter((f) => SOURCE_EXT.test(f) && !DECLARATION.test(f));

  let language: Language;
  if (declared.language) {
    language = declared.language;
    confidence.language = "declared";
  } else {
    language = detectLanguage(sources, confidence);
  }

  const aliases = await readAliases(absRoot, notes);
  const configFiles = files.filter((f) => /wdio.*\.(conf|config)\.(ts|js|mjs|cjs)$/i.test(path.basename(f)));

  let testFramework: TestFramework;
  if (declared.testFramework) {
    testFramework = declared.testFramework;
    confidence.testFramework = "declared";
  } else {
    testFramework = await detectTestFramework(absRoot, configFiles, files, confidence);
  }

  // Specs: believe the project's own config before guessing from directory names.
  const specDirsFromConfig = await specDirsFromConfigs(configFiles, absRoot);
  const specsDir =
    declared.specsDir ??
    specDirsFromConfig[0] ??
    guessDir(files, rel, /(^|\/)(test|tests|e2e|spec)s?\/(specs?|features|tests)?$/i) ??
    guessDir(files, rel, /(^|\/)(test|tests|e2e)$/i);
  confidence.specsDir = declared.specsDir
    ? "declared"
    : specDirsFromConfig[0]
      ? "detected"
      : "guessed";

  const shaped = await findPageObjectsByShape(sources, rel);
  const pageObjectDirs = declared.pageObjectDirs ?? shaped.dirs;
  confidence.pageObjectDirs = declared.pageObjectDirs ? "declared" : shaped.dirs.length ? "detected" : "guessed";

  const utilityDirs =
    declared.utilityDirs ??
    uniqueDirs(
      sources
        .map(rel)
        .filter((f) => /(^|\/)(utils?|utilities|helpers|support|common|lib)\//i.test(f))
        .filter((f) => !pageObjectDirs.some((d) => f.startsWith(`${d}/`))),
    );
  confidence.utilityDirs = declared.utilityDirs ? "declared" : "detected";

  const dataDirs = declared.dataDirs ?? detectDataDirs(files, rel);
  confidence.dataDirs = declared.dataDirs ? "declared" : dataDirs.length ? "detected" : "guessed";

  const stepDefinitionDirs =
    declared.stepDefinitionDirs ?? (testFramework === "cucumber" ? await detectStepDirs(sources, rel) : []);

  const baseClass = declared.baseClass ?? shaped.baseClass;
  confidence.baseClass = declared.baseClass ? "declared" : baseClass ? "detected" : "guessed";

  const exemplars = {
    pageObject: declared.exemplars?.pageObject ?? shaped.exemplar,
    spec: declared.exemplars?.spec ?? (await pickExemplarSpec(files, rel, specsDir)),
    stepDefinition: declared.exemplars?.stepDefinition,
  };

  if (pageObjectDirs.length === 0) {
    notes.push("No page objects found by shape — generated specs will use selectors inline unless you point at them in " + CONFIG_FILENAME);
  }
  if (!specsDir) {
    notes.push(`Could not work out where specs live. Set "specsDir" in ${CONFIG_FILENAME}.`);
  }
  if (testFramework === "cucumber" && stepDefinitionDirs.length === 0) {
    notes.push("Cucumber detected but no step definitions found — reuse will have nothing to match against.");
  }

  return {
    root: absRoot,
    language,
    testFramework,
    pageObjectDirs,
    utilityDirs,
    specsDir,
    dataDirs,
    stepDefinitionDirs,
    baseClass,
    aliases,
    exemplars,
    confidence,
    notes,
  };
}

/** Persist what was detected so a human can correct it and re-runs are stable. */
export async function writeConfigFile(layout: FrameworkLayout): Promise<string> {
  const file = path.join(layout.root, CONFIG_FILENAME);
  const body: FrameworkConfigFile = {
    language: layout.language,
    testFramework: layout.testFramework,
    pageObjectDirs: layout.pageObjectDirs,
    utilityDirs: layout.utilityDirs,
    specsDir: layout.specsDir,
    dataDirs: layout.dataDirs,
    stepDefinitionDirs: layout.stepDefinitionDirs,
    baseClass: layout.baseClass,
    exemplars: layout.exemplars,
  };
  await fs.writeFile(file, `${JSON.stringify(body, null, 2)}\n`, "utf8");
  return file;
}

async function readConfigFile(root: string, notes: string[]): Promise<FrameworkConfigFile> {
  try {
    const text = await fs.readFile(path.join(root, CONFIG_FILENAME), "utf8");
    notes.push(`Using declared layout from ${CONFIG_FILENAME}.`);
    return JSON.parse(text) as FrameworkConfigFile;
  } catch {
    return {};
  }
}

// ─── Individual detectors ────────────────────────────────────────────────────

function detectLanguage(sources: string[], confidence: Record<string, Confidence>): Language {
  const tsCount = sources.filter((f) => f.endsWith(".ts")).length;
  const jsCount = sources.length - tsCount;
  confidence.language = sources.length > 0 ? "detected" : "guessed";
  return tsCount >= jsCount ? "ts" : "js";
}

async function detectTestFramework(
  root: string,
  configFiles: string[],
  files: string[],
  confidence: Record<string, Confidence>,
): Promise<TestFramework> {
  // The wdio config states it outright; trust that above everything else.
  for (const file of configFiles) {
    const value = await readStringProperty(file, "framework");
    if (value && ["mocha", "jasmine", "cucumber"].includes(value)) {
      confidence.testFramework = "detected";
      return value as TestFramework;
    }
  }

  if (files.some((f) => f.endsWith(".feature"))) {
    confidence.testFramework = "detected";
    return "cucumber";
  }

  try {
    const pkg = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8")) as {
      devDependencies?: Record<string, string>;
      dependencies?: Record<string, string>;
    };
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const candidate of ["cucumber", "jasmine", "mocha"] as const) {
      if (deps[`@wdio/${candidate}-framework`]) {
        confidence.testFramework = "detected";
        return candidate;
      }
    }
  } catch {
    /* no package.json */
  }

  confidence.testFramework = "guessed";
  return "mocha";
}

/**
 * Find page objects by shape rather than by folder.
 *
 * A page object is a class whose members build selectors — `$()` / `$$()` in a
 * getter, a property initialiser, or a method. That holds whether the project
 * calls the folder `pageObjects`, `pages`, `po`, or nothing at all, and whether
 * it writes `private get x()` or `readonly x = $()`.
 */
async function findPageObjectsByShape(
  sources: string[],
  rel: (p: string) => string,
): Promise<{ dirs: string[]; baseClass?: string; exemplar?: string }> {
  const hits: Array<{ file: string; className: string; members: number; extends?: string; abstract: boolean }> = [];

  for (const file of sources) {
    // A helper library is not a page object even though it is full of `$()`.
    // ValidationHelper.assertElementVisible(selector) *receives* a selector;
    // a page object *declares* its elements. That is the real distinction, and
    // it is enforced below — this only skips the obvious cases early.
    if (UTILITY_DIR.test(rel(file))) continue;

    let text: string;
    try {
      text = await fs.readFile(file, "utf8");
    } catch {
      continue;
    }
    // Cheap pre-filter: skip the AST unless the file could possibly qualify.
    if (!text.includes("$(") && !text.includes("$$(")) continue;

    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    source.forEachChild((node) => {
      if (!ts.isClassDeclaration(node) || !node.name) return;

      // Only count selectors declared as instance getters/properties. Methods
      // that build a selector from an argument are helper behaviour, not an
      // element declaration, and counting them sweeps whole utility folders in.
      let selectorMembers = 0;
      for (const member of node.members) {
        if (!ts.isGetAccessorDeclaration(member) && !ts.isPropertyDeclaration(member)) continue;
        if (member.modifiers?.some((m) => m.kind === ts.SyntaxKind.StaticKeyword)) continue;
        if (buildsSelector(member)) selectorMembers += 1;
      }

      const abstract = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.AbstractKeyword) ?? false;
      if (selectorMembers === 0 && !abstract) return;

      hits.push({
        file: rel(file),
        className: node.name.text,
        members: selectorMembers,
        extends: node.heritageClauses
          ?.find((h) => h.token === ts.SyntaxKind.ExtendsKeyword)
          ?.types[0]?.expression.getText(source),
        abstract,
      });
    });
  }

  const concrete = hits.filter((h) => !h.abstract);
  const dirs = uniqueDirs(concrete.map((h) => h.file));

  // The base class is whichever parent the page objects most often extend.
  const parents = new Map<string, number>();
  for (const hit of concrete) {
    if (hit.extends) parents.set(hit.extends, (parents.get(hit.extends) ?? 0) + 1);
  }
  const baseClass = [...parents.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

  // The richest page object is the best style reference.
  const exemplar = [...concrete].sort((a, b) => b.members - a.members)[0]?.file;

  return { dirs, baseClass, exemplar };
}

/** True if the member's body or initialiser calls `$()` / `$$()`. */
function buildsSelector(member: ts.Node): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const fn = node.expression.text;
      if (fn === "$" || fn === "$$") {
        found = true;
        return;
      }
    }
    node.forEachChild(visit);
  };
  member.forEachChild(visit);
  return found;
}

/**
 * Read `specs` globs out of each wdio config and reduce them to directories.
 *
 * Projects disagree about what a relative `specs` glob is relative to — the
 * config file, or the cwd the runner is invoked from. Rather than pick a side
 * and be wrong half the time, resolve against both and keep whichever actually
 * exists on disk.
 */
async function specDirsFromConfigs(configFiles: string[], root: string): Promise<string[]> {
  const dirs: string[] = [];

  for (const file of configFiles) {
    for (const glob of await readStringArrayProperty(file, "specs")) {
      const dir = globToDir(glob);
      if (!dir) continue;

      for (const base of [path.dirname(file), root]) {
        const abs = path.resolve(base, dir);
        if (!(await isDirectory(abs))) continue;
        const relative = path.relative(root, abs).split(path.sep).join("/");
        if (relative && !relative.startsWith("..") && !dirs.includes(relative)) dirs.push(relative);
        break;
      }
    }
  }
  return dirs;
}

async function isDirectory(dir: string): Promise<boolean> {
  try {
    return (await fs.stat(dir)).isDirectory();
  } catch {
    return false;
  }
}

/** `./test/specs/**\/*.spec.ts` -> `test/specs`; a bare `**\/x.spec.ts` -> null. */
function globToDir(glob: string): string | null {
  const cleaned = glob.replace(/^\.\//, "");
  const parts = cleaned.split("/");
  const literal: string[] = [];
  for (const part of parts) {
    if (part.includes("*") || part.includes("?")) break;
    literal.push(part);
  }
  return literal.length > 0 ? literal.join("/") : null;
}

function detectDataDirs(files: string[], rel: (p: string) => string): string[] {
  const candidates = files
    .map(rel)
    .filter((f) => /\.(json|csv)$/i.test(f))
    .filter((f) => /(^|\/)(data|test-?data|fixtures?|testdata)\//i.test(f))
    // A package.json or tsconfig sitting in such a folder is not test data.
    .filter((f) => !/(^|\/)(package|tsconfig|package-lock)\.json$/i.test(f));
  return uniqueDirs(candidates);
}

async function detectStepDirs(sources: string[], rel: (p: string) => string): Promise<string[]> {
  const hits: string[] = [];
  for (const file of sources) {
    try {
      const text = await fs.readFile(file, "utf8");
      if (/\b(Given|When|Then)\s*\(/.test(text)) hits.push(rel(file));
    } catch {
      /* unreadable */
    }
  }
  return uniqueDirs(hits);
}

async function pickExemplarSpec(
  files: string[],
  rel: (p: string) => string,
  specsDir?: string,
): Promise<string | undefined> {
  const candidates = files.filter((f) => {
    const r = rel(f);
    if (specsDir && !r.startsWith(`${specsDir}/`)) return false;
    return /\.(spec|test|e2e)\.(ts|js)$/i.test(r) || (!!specsDir && SOURCE_EXT.test(r));
  });
  if (candidates.length === 0) return undefined;

  // Largest file is usually the most representative of house style.
  let best: { file: string; size: number } | undefined;
  for (const file of candidates) {
    try {
      const { size } = await fs.stat(file);
      if (!best || size > best.size) best = { file: rel(file), size };
    } catch {
      /* skip */
    }
  }
  return best?.file;
}

// ─── shared helpers ──────────────────────────────────────────────────────────

async function readAliases(root: string, notes: string[]): Promise<Record<string, string>> {
  for (const name of ["tsconfig.json", "jsconfig.json"]) {
    try {
      const file = path.join(root, name);
      const text = await fs.readFile(file, "utf8");
      const parsed = ts.parseConfigFileTextToJson(file, text);
      const paths = parsed.config?.compilerOptions?.paths as Record<string, string[]> | undefined;
      if (!paths) return {};
      const aliases: Record<string, string> = {};
      for (const [pattern, targets] of Object.entries(paths)) {
        const target = targets[0];
        if (!target) continue;
        aliases[pattern.replace(/\/\*$/, "")] = target.replace(/^\.\//, "").replace(/\/\*$/, "");
      }
      return aliases;
    } catch {
      /* try the next one */
    }
  }
  notes.push("No tsconfig/jsconfig paths found — generated imports will be relative.");
  return {};
}

async function readSourceFile(file: string): Promise<ts.SourceFile | null> {
  try {
    const text = await fs.readFile(file, "utf8");
    return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  } catch {
    return null;
  }
}

async function readStringProperty(file: string, key: string): Promise<string | undefined> {
  const source = await readSourceFile(file);
  if (!source) return undefined;
  let value: string | undefined;
  const visit = (node: ts.Node): void => {
    if (value) return;
    if (ts.isPropertyAssignment(node) && propertyName(node) === key) {
      if (ts.isStringLiteralLike(node.initializer)) value = node.initializer.text;
      else if (ts.isBinaryExpression(node.initializer) && ts.isStringLiteralLike(node.initializer.right)) {
        value = node.initializer.right.text;
      }
    }
    node.forEachChild(visit);
  };
  visit(source);
  return value;
}

async function readStringArrayProperty(file: string, key: string): Promise<string[]> {
  const source = await readSourceFile(file);
  if (!source) return [];
  const values: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isPropertyAssignment(node) &&
      propertyName(node) === key &&
      ts.isArrayLiteralExpression(node.initializer)
    ) {
      for (const element of node.initializer.elements) {
        if (ts.isStringLiteralLike(element)) values.push(element.text);
      }
    }
    node.forEachChild(visit);
  };
  visit(source);
  return values;
}

function propertyName(node: ts.PropertyAssignment): string {
  const name = node.name;
  return ts.isIdentifier(name) || ts.isStringLiteralLike(name) ? name.text : name.getText();
}

function guessDir(files: string[], rel: (p: string) => string, pattern: RegExp): string | undefined {
  const dirs = uniqueDirs(files.map(rel));
  return dirs.find((d) => pattern.test(d));
}

/** Collapse file paths to their distinct parent directories, shallowest first. */
function uniqueDirs(files: string[]): string[] {
  const dirs = new Set<string>();
  for (const file of files) {
    const dir = file.includes("/") ? file.slice(0, file.lastIndexOf("/")) : "";
    if (dir) dirs.add(dir);
  }
  const all = [...dirs];
  // Drop a directory when an ancestor is already listed, to keep globs tidy.
  return all
    .filter((dir) => !all.some((other) => other !== dir && dir.startsWith(`${other}/`)))
    .sort();
}

export async function walk(dir: string, depth = 0): Promise<string[]> {
  if (depth > 10) return [];
  const out: string[] = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
      out.push(...(await walk(path.join(dir, entry.name), depth + 1)));
    } else if (entry.isFile()) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}
