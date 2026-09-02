import {
  SELECTOR_CONST_SUFFIX,
  SELECTOR_DIR,
  SELECTOR_SUFFIX,
  methodsFor,
  type ElementFact,
  type Interaction,
  type PageFact,
} from "./structure.js";
import type { ProjectLanguage } from "./types.js";

/**
 * Render the client's page objects, selector maps and flows.
 *
 * Selectors live in their own module rather than inside the page class, and that
 * split is the single most important decision here. When a new build moves an
 * element, the only thing that is wrong is one string. Keeping selectors as data
 * makes that a one-line edit — by a human or by the tool — instead of a
 * regeneration of the class, which would discard anything anyone had added to
 * it by hand.
 *
 * Every import written here keeps a `.js` suffix even in a TypeScript project.
 * That is not a leftover: Node's ESM resolution matches the specifier against
 * the file that will exist at runtime, and TypeScript is designed to be written
 * that way under NodeNext. It also means these strings are identical in both
 * languages, so the scanners that later rewrite specs into page-object calls
 * have one shape to recognise rather than two.
 */

export function renderSelectors(page: PageFact, language: ProjectLanguage = "js"): string {
  const entries = page.elements
    .map((element) => `  /** ${element.label} */\n  ${element.property}: ${JSON.stringify(element.selector)},`)
    .join("\n");

  return `/**
 * Selectors for ${page.className}.${page.url ? `\n * Observed at ${page.url}` : ""}
 *
 * Generated from a verified run, then maintained here. When a build moves an
 * element, change the string — nothing else needs to know.
 */
export const ${selectorConst(page)} = {
${entries}
}${language === "ts" ? " as const" : ""};
`;
}

export function renderPage(page: PageFact, language: ProjectLanguage = "js"): string {
  const constName = selectorConst(page);
  const methods = page.elements.flatMap((element) => renderMethods(element, constName, language)).join("\n\n");
  // The observed URL becomes the fallback rather than the value: `baseUrl`
  // returns it unchanged unless the run configures an environment, so this is
  // identical to a hardcoded URL until someone actually points the suite at
  // staging — at which point it is one variable instead of an edit per page.
  const navigate = page.url
    ? `
  /** Open this page directly, against the configured environment. */
  async open() {
    await browser.url(baseUrl(${JSON.stringify(page.url)}));
    await this.waitUntilLoaded();
  }
`
    : "";

  // Only when there is an `open()` to use it — a mobile screen has no URL, and
  // an unused import is the first thing a client's own linter complains about.
  const envImport = page.url ? `import { baseUrl } from '../utils/env.js';\n` : "";

  return `import { BasePage } from './BasePage.js';
${envImport}import { ${constName} } from '../${SELECTOR_DIR}/${page.slug}.${SELECTOR_SUFFIX}.js';

/**
 * ${page.className}${page.url ? ` — ${page.url}` : ""}
 *
 * Grown from verified runs. Methods here are safe to edit and safe to add to:
 * the tool only ever adds what is missing, and never rewrites this file.
 */
export class ${page.className} extends BasePage {
${navigate}${methods}
}

export const ${instanceName(page)} = new ${page.className}();
`;
}

function renderMethods(element: ElementFact, constName: string, language: ProjectLanguage): string[] {
  return methodsFor(element).map(({ name, interaction }) =>
    renderMethodBody(element, constName, name, interaction, language),
  );
}

/**
 * One page-object method.
 *
 * The single source for this shape. `persist.ts` appends methods to a page
 * that already exists and calls straight into here rather than keeping its own
 * copy: a method added on a later run has to be indistinguishable from one
 * written when the page was created, and two parallel implementations of that
 * is exactly how they stop being.
 */
export function renderMethodBody(
  element: ElementFact,
  constName: string,
  name: string,
  interaction: Interaction,
  language: ProjectLanguage,
): string {
  const locator = `${constName}.${element.property}`;
  const label = JSON.stringify(element.label);
  // Mirrors the runtime's own `TypedValue`: a spec passes credentials straight
  // from process.env, which is `string | undefined`, and the missing-credential
  // case is one the runtime reports far better than a compile error would.
  const valueParam = language === "ts" ? "value: string | number | null | undefined" : "value";
  // Carried by the method rather than by the caller, so a credential field is
  // masked however it is reached — and so a spec never has to keep the raw
  // `type(selector, value, { mask: true })` call just to preserve the flag.
  const masked = element.masked ? ", { mask: true }" : "";

  switch (interaction) {
    case "click":
      return `  async ${name}() {\n    await this.click(${locator}, ${label});\n  }`;
    case "type":
      return `  async ${name}(${valueParam}) {\n    await this.type(${locator}, value, ${label}${masked});\n  }`;
    case "read":
      return `  async ${name}() {\n    return this.getText(${locator}, ${label});\n  }`;
    case "check":
      return `  async ${name}() {\n    return this.isVisible(${locator});\n  }`;
    case "wait":
      return `  async ${name}() {\n    await this.waitForGone(${locator});\n  }`;
    case "dismiss":
      return `  async ${name}() {\n    await this.dismissIfPresent(${locator}, ${label});\n  }`;
  }
}

/**
 * The base every page extends.
 *
 * Thin on purpose: it forwards to the framework runtime rather than
 * reimplementing it, so the waiting and the failure diagnostics are identical
 * whether a spec calls a page object or the helpers directly.
 */
export function renderBasePage(language: ProjectLanguage = "js"): string {
  const ts = language === "ts";
  const selector = ts ? "selector: string" : "selector";
  const label = ts ? "label?: string" : "label";
  // Matches the runtime's own TypedValue - see renderMethods for why this
  // deliberately admits undefined rather than demanding a string.
  const value = ts ? "value: string | number | null | undefined" : "value";
  // Only `type` takes one today (masking a credential field), but it is the
  // options bag the runtime helper already accepts, so widening it later costs
  // nothing at these call sites.
  const options = ts ? "options?: { mask?: boolean }" : "options";
  const returns = (type: string) => (ts ? `: Promise<${type}>` : "");

  return `import * as wdio from '@testlab/framework';

/**
 * Shared behaviour for every page object.
 *
 * Deliberately a thin pass-through to @testlab/framework: page objects should
 * add naming and structure, not a second implementation of waiting. Anything
 * added here is available to every page — put genuinely shared behaviour in it,
 * and leave page-specific behaviour on the page.
 */
export class BasePage {
  async click(${selector}, ${label})${returns("void")} {
    await wdio.click(selector, { label });
  }

  async type(${selector}, ${value}, ${label}, ${options})${returns("void")} {
    await wdio.type(selector, value, { label, ...options });
  }

  async getText(${selector}, ${label})${returns("string")} {
    return wdio.getText(selector, { label });
  }

  async isVisible(${selector})${returns("boolean")} {
    return wdio.isVisible(selector);
  }

  async waitForGone(${selector})${returns("void")} {
    await wdio.waitForGone(selector);
  }

  async dismissIfPresent(${selector}, ${label})${returns("boolean")} {
    return wdio.dismissIfPresent(selector, { label });
  }

  /** Override on a page that has a better readiness signal than the document. */
  async waitUntilLoaded()${returns("void")} {
    await wdio.waitForPageLoad();
  }
}
`;
}

/**
 * A business flow: the whole scenario as one reusable function.
 *
 * This is what makes the second spec cheap. "Log in" is a precondition for
 * almost every other scenario, and once it exists as a flow, later specs call
 * it in one line instead of rediscovering the login screen.
 */
export function renderFlow(args: {
  name: string;
  title: string;
  pages: PageFact[];
  /**
   * Parameter names. Typed as plain strings in a TypeScript project rather
   * than left bare, which would emit implicit-`any` parameters — a typed
   * input/output shape per flow is a larger, separate piece of work.
   */
  parameters: string[];
  steps: Array<{ page: PageFact; method: string; argument?: string }>;
  language?: ProjectLanguage;
}): string {
  const parameters =
    args.language === "ts" ? args.parameters.map((name) => `${name}: string`) : args.parameters;
  const imports = [...new Set(args.pages.map((p) => p.slug))]
    .map((slug) => {
      const page = args.pages.find((p) => p.slug === slug)!;
      return `import { ${instanceName(page)} } from '../pages/${page.className}.js';`;
    })
    .join("\n");

  const body = args.steps
    .map((step) => `  await ${instanceName(step.page)}.${step.method}(${step.argument ?? ""});`)
    .join("\n");

  return `${imports}

/**
 * ${args.title}
 *
 * Extracted from a verified run. Call this from any spec that needs it as a
 * precondition rather than repeating the steps.
 */
export async function ${args.name}(${parameters.join(", ")})${args.language === "ts" ? ": Promise<void>" : ""} {
${body}
}
`;
}

export function selectorConst(page: PageFact): string {
  return `${page.className.replace(/Page$/, "")}${SELECTOR_CONST_SUFFIX}`;
}

function instanceName(page: PageFact): string {
  return page.className[0]!.toLowerCase() + page.className.slice(1);
}
