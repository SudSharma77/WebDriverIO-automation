import fs from "node:fs/promises";
import path from "node:path";
import { renderBasePage, renderMethodBody, renderPage, renderSelectors, selectorConst } from "./codegen.js";
import { sourceExt, type ClientProject } from "./project.js";
import { MASK_OPTION, SELECTOR_DIR, SELECTOR_SUFFIX, methodsFor, type PageFact } from "./structure.js";
import type { ProjectLanguage } from "./types.js";

/**
 * Write structured knowledge into the client's project.
 *
 * The governing rule is additive-only. A client edits these files — renames a
 * method, adds an assertion, fixes a selector by hand — and a tool that
 * regenerates them wholesale on the next run silently destroys that work. So a
 * page that already exists gains only the members it is missing, and a locator
 * that already has a value keeps it unless the run proved a new one.
 */

export interface StoredPage {
  className: string;
  file: string;
  created: boolean;
  addedElements: string[];
  addedMethods: string[];
  changedLocators: Array<{ property: string; from: string; to: string }>;
  /**
   * Methods on an existing page that type into a credential field but do not
   * mask it.
   *
   * Reported rather than repaired: rewriting a method the client may have
   * edited is the one thing this module never does. These are pages written
   * before masking moved onto the element, so the fix is forward-only — a
   * one-line edit a human makes once, surfaced instead of left silent.
   */
  unmaskedMethods: string[];
}

export async function storePages(project: ClientProject, pages: PageFact[]): Promise<StoredPage[]> {
  if (pages.length === 0) return [];

  const pagesDir = path.join(project.root, "src", "pages");
  const selectorsDir = path.join(project.root, "src", SELECTOR_DIR);
  await fs.mkdir(pagesDir, { recursive: true });
  await fs.mkdir(selectorsDir, { recursive: true });

  const language = project.language;
  const ext = sourceExt(language);

  // Created once. Regenerating it would discard shared behaviour the client
  // added for every page in their suite.
  await writeIfAbsent(path.join(pagesDir, `BasePage${ext}`), renderBasePage(language));

  const stored: StoredPage[] = [];
  for (const page of pages) {
    stored.push(await storePage(pagesDir, selectorsDir, page, language));
  }
  return stored;
}

async function storePage(
  pagesDir: string,
  selectorsDir: string,
  page: PageFact,
  language: ProjectLanguage,
): Promise<StoredPage> {
  const ext = sourceExt(language);
  const pageFile = path.join(pagesDir, `${page.className}${ext}`);
  const selectorFile = path.join(selectorsDir, `${page.slug}.${SELECTOR_SUFFIX}${ext}`);

  const existingPage = await readOrNull(pageFile);
  const existingSelectors = await readOrNull(selectorFile);

  if (!existingPage && !existingSelectors) {
    await fs.writeFile(selectorFile, renderSelectors(page, language), "utf8");
    await fs.writeFile(pageFile, renderPage(page, language), "utf8");
    return {
      className: page.className,
      file: path.relative(path.dirname(pagesDir), pageFile),
      created: true,
      addedElements: page.elements.map((e) => e.property),
      addedMethods: page.elements.flatMap((e) => methodsFor(e).map((m) => m.name)),
      changedLocators: [],
      unmaskedMethods: [],
    };
  }

  const changedLocators: Array<{ property: string; from: string; to: string }> = [];
  const addedElements: string[] = [];
  const addedMethods: string[] = [];
  const unmaskedMethods: string[] = [];

  let selectorSource = existingSelectors ?? renderSelectors({ ...page, elements: [] }, language);
  for (const element of page.elements) {
    const current = readSelectorValue(selectorSource, element.property);

    if (current === null) {
      selectorSource = appendSelector(selectorSource, element.property, element.selector, element.label);
      addedElements.push(element.property);
    } else if (current !== element.selector) {
      // The run just proved the new one works, so it wins — but the change is
      // reported rather than applied silently, because a moved element is
      // usually the most interesting thing about a new build.
      selectorSource = replaceSelector(selectorSource, element.property, element.selector);
      changedLocators.push({ property: element.property, from: current, to: element.selector });
    }
  }

  let pageSource = existingPage ?? renderPage({ ...page, elements: [] }, language);
  for (const element of page.elements) {
    for (const { name, interaction } of methodsFor(element)) {
      if (!hasMethod(pageSource, name)) {
        pageSource = appendMethod(pageSource, renderSingleMethod(page, element.property, name, language));
        addedMethods.push(name);
        continue;
      }
      // Present already, so it stays exactly as it is — but a typing method on
      // a credential field that predates element-level masking would log the
      // value, and that is worth saying out loud.
      if (element.masked && interaction === "type" && !methodMasks(pageSource, name)) {
        unmaskedMethods.push(name);
      }
    }
  }

  await fs.writeFile(selectorFile, selectorSource, "utf8");
  await fs.writeFile(pageFile, pageSource, "utf8");

  return {
    className: page.className,
    file: path.relative(path.dirname(pagesDir), pageFile),
    created: false,
    addedElements,
    addedMethods,
    changedLocators,
    unmaskedMethods,
  };
}

/**
 * Delegates to codegen's renderer rather than reimplementing it: a method
 * appended to an existing page has to be byte-identical to one written when the
 * page was created, and the two used to be separate copies that had to be kept
 * in step by hand.
 */
function renderSingleMethod(page: PageFact, property: string, methodName: string, language: ProjectLanguage): string {
  const element = page.elements.find((e) => e.property === property)!;
  const interaction = methodsFor(element).find((m) => m.name === methodName)!.interaction;
  return renderMethodBody(element, selectorConst(page), methodName, interaction, language);
}

/** Method presence by name, which is what "already has this" means here. */
function hasMethod(source: string, name: string): boolean {
  return new RegExp(`\\basync\\s+${escapeRegExp(name)}\\s*\\(`).test(source);
}

/**
 * Whether an existing method already masks. Scoped to that method's own body
 * (up to the next `async`, or the end) so a masked method elsewhere on the same
 * page cannot vouch for an unmasked one.
 */
function methodMasks(source: string, name: string): boolean {
  const start = new RegExp(`\\basync\\s+${escapeRegExp(name)}\\s*\\(`).exec(source);
  if (!start) return false;
  const rest = source.slice(start.index + start[0].length);
  const nextMethod = /\basync\s+\w+\s*\(/.exec(rest);
  return MASK_OPTION.test(nextMethod ? rest.slice(0, nextMethod.index) : rest);
}

/**
 * Insert before the class's closing brace.
 *
 * Found by scanning back from the end for the last `}` that closes a class
 * body: the file ends with an instance export, so the final brace in the file
 * is not the one we want.
 */
function appendMethod(source: string, method: string): string {
  const classEnd = findClassEnd(source);
  if (classEnd === -1) return source;
  const before = source.slice(0, classEnd);
  const after = source.slice(classEnd);
  return `${before.replace(/\s*$/, "")}\n\n${method}\n${after}`;
}

function findClassEnd(source: string): number {
  const classStart = source.search(/\bclass\s+\w+/);
  if (classStart === -1) return -1;

  let depth = 0;
  let started = false;
  for (let i = classStart; i < source.length; i++) {
    const char = source[i];
    if (char === "{") {
      depth++;
      started = true;
    } else if (char === "}") {
      depth--;
      if (started && depth === 0) return i;
    }
  }
  return -1;
}

function readSelectorValue(source: string, property: string): string | null {
  const match = new RegExp(`\\b${escapeRegExp(property)}\\s*:\\s*(['"\`])((?:[^\\\\]|\\\\.)*?)\\1`).exec(source);
  return match?.[2] ?? null;
}

function replaceSelector(source: string, property: string, selector: string): string {
  return source.replace(
    new RegExp(`(\\b${escapeRegExp(property)}\\s*:\\s*)(['"\`])(?:[^\\\\]|\\\\.)*?\\2`),
    `$1${JSON.stringify(selector)}`,
  );
}

/**
 * Insert a new entry just before the object's closing brace.
 *
 * Anchored on a brace at the start of a line rather than on the literal `};`,
 * because a TypeScript selector map closes with `} as const;` — matching the
 * old two-character sequence found nothing there and appended the entry *after*
 * the object instead, producing a file that no longer parses. A selector string
 * cannot fake this anchor: JSON.stringify escapes any real newline it contains.
 */
function appendSelector(source: string, property: string, selector: string, label: string): string {
  const close = source.lastIndexOf("\n}");
  const entry = `  /** ${label} */\n  ${property}: ${JSON.stringify(selector)},\n`;
  if (close === -1) return `${source}\n${entry}`;
  return `${source.slice(0, close + 1)}${entry}${source.slice(close + 1)}`;
}

async function readOrNull(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, "utf8");
  } catch {
    return null;
  }
}

async function writeIfAbsent(file: string, contents: string): Promise<void> {
  try {
    await fs.writeFile(file, contents, { encoding: "utf8", flag: "wx" });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
  }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
