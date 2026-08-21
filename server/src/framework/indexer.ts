import fs from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import { detectLayout, walk } from "./detect.js";
import type {
  ConfigInfo,
  DataFileInfo,
  ElementInfo,
  FrameworkIndex,
  FrameworkLayout,
  HelperInfo,
  LanePlatform,
  MethodInfo,
  PageObjectInfo,
  SpecInfo,
  StepDefinitionInfo,
} from "./types.js";

/**
 * Build a structural map of an existing WebdriverIO framework.
 *
 * Parsed with the TypeScript AST rather than regex. The whole point of this
 * index is to answer "does a method for this already exist?" — a regex that
 * mistakes a commented-out method or a nested arrow function for a real one
 * produces a confidently wrong reuse decision, which is worse than no index.
 *
 * Syntactic parsing only (`createSourceFile`, no Program): names, signatures
 * and literal selectors are all we need, and skipping the type checker keeps
 * this fast enough to re-run before every plan.
 *
 * Every path comes from the detected (or declared) layout — nothing here knows
 * that one particular project keeps page objects in `src/pageObjects`.
 */
export async function indexFramework(
  root: string,
  opts: { layout?: FrameworkLayout } = {},
): Promise<FrameworkIndex> {
  const absRoot = path.resolve(root);
  if (!(await isDirectory(absRoot))) {
    throw new Error(`Framework root "${absRoot}" is not a readable directory.`);
  }

  const layout = opts.layout ?? (await detectLayout(absRoot));
  const warnings = [...layout.notes];

  const files = await walk(absRoot);
  const rel = (p: string) => path.relative(absRoot, p).split(path.sep).join("/");
  const sources = files.filter((f) => /\.(ts|js|mjs|cjs)$/.test(f) && !f.endsWith(".d.ts"));

  const inAny = (file: string, dirs: string[]) => dirs.some((dir) => rel(file).startsWith(`${dir}/`));

  const pageObjects: PageObjectInfo[] = [];
  let baseClass: FrameworkIndex["baseClass"];

  for (const file of sources.filter((f) => inAny(f, layout.pageObjectDirs))) {
    const source = await readSource(file);
    if (!source) continue;

    for (const cls of classesIn(source)) {
      const info = describeClass(cls, source);
      const relPath = rel(file);

      // A base class is vocabulary, not a page. Kept separate so the generator
      // reuses `this.clickElement()` rather than reinventing it.
      const isBase = isAbstract(cls) || cls.name?.text === layout.baseClass;
      if (isBase) {
        baseClass = {
          className: info.className,
          file: relPath,
          helpers: info.methods.filter((m) => m.visibility !== "private").map(signature),
        };
        continue;
      }

      const exported = readExportStyle(source, info.className);
      pageObjects.push({
        className: info.className,
        file: relPath,
        importPath: toImportPath(relPath, layout.aliases),
        extends: info.extendsName,
        platform: platformOf(relPath, info.className),
        exportStyle: exported.style,
        defaultExport: exported.isDefault,
        elements: info.elements,
        methods: info.methods.filter((m) => m.visibility === "public"),
      });
    }
  }

  const helpers: HelperInfo[] = [];
  for (const file of sources.filter((f) => inAny(f, layout.utilityDirs))) {
    if (/(^|\/)index\.(ts|js)$/.test(rel(file))) continue;
    const source = await readSource(file);
    if (!source) continue;
    for (const cls of classesIn(source)) {
      const info = describeClass(cls, source);
      const methods = info.methods.filter((m) => m.visibility === "public");
      if (methods.length === 0) continue;
      helpers.push({
        className: info.className,
        file: rel(file),
        importPath: toImportPath(rel(file), layout.aliases),
        methods,
      });
    }
  }

  const specs: SpecInfo[] = [];
  const specDir = layout.specsDir;
  for (const file of sources) {
    const relPath = rel(file);
    const looksLikeSpec = /\.(spec|test|e2e)\.(ts|js)$/i.test(relPath);
    const inSpecDir = specDir ? relPath.startsWith(`${specDir}/`) : false;
    if (!looksLikeSpec && !inSpecDir) continue;
    const source = await readSource(file);
    if (!source) continue;
    const suites = describeSuites(source);
    if (suites.length > 0) specs.push({ file: relPath, suites });
  }

  const stepDefinitions: StepDefinitionInfo[] = [];
  for (const file of sources.filter((f) => inAny(f, layout.stepDefinitionDirs))) {
    const source = await readSource(file);
    if (source) stepDefinitions.push(...describeSteps(source, rel(file)));
  }

  const configs: ConfigInfo[] = [];
  for (const file of files.filter((f) => /wdio.*\.(conf|config)\.(ts|js|mjs|cjs)$/i.test(path.basename(f)))) {
    const source = await readSource(file);
    if (!source) continue;
    configs.push({
      platform: /wdio\.?(.*)\.(conf|config)\./i.exec(path.basename(file))?.[1] || "default",
      file: rel(file),
      specs: stringArrayProperty(source, "specs"),
      baseUrl: stringProperty(source, "baseUrl"),
    });
  }

  const data = await readDataFiles(files, rel, layout.dataDirs, warnings);

  const index: FrameworkIndex = {
    root: absRoot,
    layout,
    aliases: layout.aliases,
    baseClass,
    pageObjects,
    helpers,
    data,
    specs,
    configs,
    stepDefinitions,
    warnings,
    indexedAt: Date.now(),
  };

  addStructuralWarnings(index);
  return index;
}

// ─── TypeScript AST helpers ──────────────────────────────────────────────────

async function readSource(file: string): Promise<ts.SourceFile | null> {
  try {
    const text = await fs.readFile(file, "utf8");
    return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  } catch {
    return null;
  }
}

function classesIn(source: ts.SourceFile): ts.ClassDeclaration[] {
  const found: ts.ClassDeclaration[] = [];
  source.forEachChild((node) => {
    if (ts.isClassDeclaration(node) && node.name) found.push(node);
  });
  return found;
}

function isAbstract(cls: ts.ClassDeclaration): boolean {
  return cls.modifiers?.some((m) => m.kind === ts.SyntaxKind.AbstractKeyword) ?? false;
}

interface ClassDescription {
  className: string;
  extendsName?: string;
  elements: ElementInfo[];
  methods: MethodInfo[];
}

function describeClass(cls: ts.ClassDeclaration, source: ts.SourceFile): ClassDescription {
  const elements: ElementInfo[] = [];
  const methods: MethodInfo[] = [];

  for (const member of cls.members) {
    // Both `private get x() { return $('…') }` and `readonly x = $('…')` are
    // common house styles; accept either rather than favouring one project.
    if ((ts.isGetAccessorDeclaration(member) || ts.isPropertyDeclaration(member)) && member.name) {
      const locator = readLocator(member);
      if (locator) elements.push({ name: nameOf(member.name), ...locator });
      continue;
    }
    if (ts.isMethodDeclaration(member) && member.name) {
      methods.push({
        name: nameOf(member.name),
        params: member.parameters.map((p) => ({
          name: nameOf(p.name),
          type: p.type ? p.type.getText(source) : "any",
          optional: !!p.questionToken || !!p.initializer,
        })),
        // Unannotated (plain JS) stays empty rather than being asserted as
        // Promise<void> — claiming a getter returns nothing misleads the
        // generator into discarding a value the method actually provides.
        returnType: member.type ? member.type.getText(source) : "",
        doc: firstDocLine(member),
        visibility: visibilityOf(member),
        isStatic: member.modifiers?.some((m) => m.kind === ts.SyntaxKind.StaticKeyword) ?? false,
      });
    }
  }

  const extendsName = cls.heritageClauses
    ?.find((h) => h.token === ts.SyntaxKind.ExtendsKeyword)
    ?.types[0]?.expression.getText(source);

  return { className: cls.name!.text, extendsName, elements, methods };
}

/** Pull `$('sel')` / `$$('sel')` out of a member when it is a plain literal. */
function readLocator(member: ts.Node): { selector?: string; multiple: boolean } | null {
  let result: { selector?: string; multiple: boolean } | null = null;

  const visit = (node: ts.Node): void => {
    if (result) return;
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const fn = node.expression.text;
      if (fn === "$" || fn === "$$") {
        const arg = node.arguments[0];
        result = { multiple: fn === "$$", selector: arg && ts.isStringLiteralLike(arg) ? arg.text : undefined };
        return;
      }
    }
    node.forEachChild(visit);
  };

  member.forEachChild(visit);
  return result;
}

function visibilityOf(member: ts.MethodDeclaration): MethodInfo["visibility"] {
  for (const modifier of member.modifiers ?? []) {
    if (modifier.kind === ts.SyntaxKind.PrivateKeyword) return "private";
    if (modifier.kind === ts.SyntaxKind.ProtectedKeyword) return "protected";
  }
  return "public";
}

function firstDocLine(node: ts.Node): string | undefined {
  const docs = (node as unknown as { jsDoc?: ts.JSDoc[] }).jsDoc;
  const comment = docs?.[0]?.comment;
  const text = typeof comment === "string" ? comment : undefined;
  return text?.split("\n")[0]?.trim() || undefined;
}

function nameOf(node: ts.Node): string {
  return ts.isIdentifier(node) || ts.isStringLiteralLike(node) ? node.text : node.getText();
}

/**
 * Decide whether a spec must construct the page object or just import it.
 *
 * `module.exports = new CheckoutPage()` and `export default new LoginPage()`
 * hand back a ready instance; a plain `export class` does not. Getting this
 * wrong emits either `new` on an instance or a method call on a constructor,
 * both of which fail at runtime rather than at compile time.
 */
function readExportStyle(
  source: ts.SourceFile,
  className: string,
): { style: "class" | "instance" | "unknown"; isDefault: boolean } {
  let style: "class" | "instance" | "unknown" = "unknown";
  let isDefault = false;

  const constructsTarget = (expr: ts.Expression): boolean =>
    ts.isNewExpression(expr) && ts.isIdentifier(expr.expression) && expr.expression.text === className;

  source.forEachChild((node) => {
    // export default class X {} | export default new X()
    if (ts.isClassDeclaration(node) && node.name?.text === className) {
      const mods = node.modifiers ?? [];
      if (mods.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
        style = style === "unknown" ? "class" : style;
        if (mods.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)) isDefault = true;
      }
      return;
    }
    if (ts.isExportAssignment(node)) {
      isDefault = true;
      style = constructsTarget(node.expression) ? "instance" : "class";
      return;
    }
    // CommonJS: module.exports = new X() | exports.X = new X()
    if (ts.isExpressionStatement(node) && ts.isBinaryExpression(node.expression)) {
      const { left, right } = node.expression;
      if (/^(module\.)?exports(\.\w+)?$/.test(left.getText(source))) {
        isDefault = /^(module\.)?exports$/.test(left.getText(source));
        style = constructsTarget(right) ? "instance" : "class";
      }
    }
  });

  return { style, isDefault };
}

/** `describe(...)` / `it(...)` titles, so the planner can spot duplicate coverage. */
function describeSuites(source: ts.SourceFile): SpecInfo["suites"] {
  const suites: SpecInfo["suites"] = [];

  const visit = (node: ts.Node, current: { title: string; tests: string[] } | null): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const fn = node.expression.text;
      const first = node.arguments[0];
      const title = first && ts.isStringLiteralLike(first) ? first.text : null;

      if (fn === "describe" && title) {
        const suite = { title, tests: [] as string[] };
        suites.push(suite);
        node.forEachChild((child) => visit(child, suite));
        return;
      }
      if ((fn === "it" || fn === "test") && title && current) current.tests.push(title);
    }
    node.forEachChild((child) => visit(child, current));
  };

  visit(source, null);
  return suites;
}

/** Cucumber: the reuse surface is step definitions, matched by their expression. */
function describeSteps(source: ts.SourceFile, file: string): StepDefinitionInfo[] {
  const steps: StepDefinitionInfo[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const keyword = node.expression.text;
      if (keyword === "Given" || keyword === "When" || keyword === "Then") {
        const first = node.arguments[0];
        const pattern = first
          ? ts.isStringLiteralLike(first)
            ? first.text
            : ts.isRegularExpressionLiteral(first)
              ? first.text
              : null
          : null;
        if (pattern) steps.push({ file, keyword, pattern });
      }
    }
    node.forEachChild(visit);
  };

  visit(source);
  return steps;
}

function stringArrayProperty(source: ts.SourceFile, key: string): string[] {
  const values: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isPropertyAssignment(node) &&
      nameOf(node.name) === key &&
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

function stringProperty(source: ts.SourceFile, key: string): string | undefined {
  let value: string | undefined;
  const visit = (node: ts.Node): void => {
    if (value) return;
    if (ts.isPropertyAssignment(node) && nameOf(node.name) === key) {
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

function signature(method: MethodInfo): string {
  const params = method.params
    .map((p) => (p.type && p.type !== "any" ? `${p.name}${p.optional ? "?" : ""}: ${p.type}` : p.name))
    .join(", ");
  return `${method.name}(${params})${method.returnType ? `: ${method.returnType}` : ""}`;
}

// ─── Layout-derived helpers ──────────────────────────────────────────────────

/** Prefer the project's own alias (`@pages/web/HomePage`) over a relative path. */
function toImportPath(relFile: string, aliases: Record<string, string>): string {
  const withoutExt = relFile.replace(/\.(ts|js|mjs|cjs)$/, "");
  for (const [alias, target] of Object.entries(aliases)) {
    if (withoutExt.startsWith(`${target}/`)) return `${alias}/${withoutExt.slice(target.length + 1)}`;
  }
  return `./${withoutExt}`;
}

/** Best-effort: from the path first, then the class name. */
function platformOf(relFile: string, className: string): LanePlatform {
  const haystack = `${relFile} ${className}`;
  if (/\b(web|desktop|browser)\b|\/(web)\//i.test(haystack)) return "web";
  if (/\b(mobile|android|ios|native)\b/i.test(haystack)) return "mobile";
  return "shared";
}

async function readDataFiles(
  files: string[],
  rel: (p: string) => string,
  dataDirs: string[],
  warnings: string[],
): Promise<DataFileInfo[]> {
  const out: DataFileInfo[] = [];

  for (const file of files) {
    const relPath = rel(file);
    if (!dataDirs.some((dir) => relPath.startsWith(`${dir}/`))) continue;
    if (!/\.(json|csv)$/i.test(relPath)) continue;

    const format = relPath.toLowerCase().endsWith(".json") ? "json" : "csv";
    try {
      const text = await fs.readFile(file, "utf8");
      if (format === "json") {
        const parsed: unknown = JSON.parse(text);
        const records = Array.isArray(parsed) ? parsed : [parsed];
        const first = records[0];
        out.push({
          file: relPath,
          name: path.basename(relPath).replace(/\.json$/i, ""),
          format,
          recordCount: records.length,
          fields: first && typeof first === "object" ? Object.keys(first as object) : [],
        });
      } else {
        const lines = text.split(/\r?\n/).filter((l) => l.trim());
        out.push({
          file: relPath,
          name: path.basename(relPath).replace(/\.csv$/i, ""),
          format,
          recordCount: Math.max(0, lines.length - 1),
          fields: lines[0]?.split(",").map((h) => h.trim()) ?? [],
        });
      }
    } catch {
      warnings.push(`Could not parse data file ${relPath} — it will not be offered as a data source.`);
    }
  }
  return out;
}

/** Things that will silently break a generated test if nobody notices them. */
function addStructuralWarnings(index: FrameworkIndex): void {
  for (const config of index.configs) {
    // The question is whether a *new* file could ever match. A glob whose
    // filename part contains a wildcard can accept one (given the right name);
    // a literal filename never can, no matter what we generate.
    const acceptsNewFiles = config.specs.some((glob) => {
      const basename = glob.split("/").pop() ?? glob;
      return basename.includes("*");
    });

    if (config.specs.length > 0 && !acceptsNewFiles) {
      index.warnings.push(
        `${config.file} runs only ${config.specs.join(", ")}, which is a fixed filename — no newly generated spec can ever match it. Widen it (e.g. './test/specs/**/*.spec.ts') or run new specs with --spec.`,
      );
    }
  }

  if (index.pageObjects.length === 0 && index.stepDefinitions.length === 0) {
    index.warnings.push(
      "No page objects or step definitions found. Every request will create new code rather than reusing any.",
    );
  }

  if (index.pageObjects.length > 0 && !index.pageObjects.some((p) => p.platform === "mobile")) {
    index.warnings.push("No mobile page objects exist, so Android/iOS requests have no established pattern to follow.");
  }

  const sampleSelectors = index.pageObjects.flatMap((p) => p.elements).filter((e) => e.selector?.includes("data-testid")).length;
  if (sampleSelectors > 0 && index.pageObjects.length <= 1) {
    index.warnings.push(
      "The only page object looks like a shipped sample. Its selectors probably match nothing in the real app under test.",
    );
  }
}

// ─── fs ──────────────────────────────────────────────────────────────────────

async function isDirectory(dir: string): Promise<boolean> {
  try {
    return (await fs.stat(dir)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Resolve a framework path against several plausible bases.
 *
 * `npm run --workspace server` executes with the cwd set to `server/`, so a
 * path typed relative to the repo root silently resolves somewhere that does
 * not exist. Trying each base — and naming all of them when none match — turns
 * a confusing ENOENT into an obvious one.
 */
export async function resolveFrameworkRoot(input: string, bases: string[]): Promise<string> {
  if (path.isAbsolute(input)) {
    if (await isDirectory(input)) return input;
    throw new Error(`Framework root "${input}" is not a readable directory.`);
  }

  const tried: string[] = [];
  for (const base of bases) {
    const candidate = path.resolve(base, input);
    if (tried.includes(candidate)) continue;
    tried.push(candidate);
    if (await isDirectory(candidate)) return candidate;
  }

  throw new Error([`Could not find a framework at "${input}". Looked in:`, ...tried.map((t) => `  - ${t}`)].join("\n"));
}
