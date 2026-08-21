import {
  SELECTOR_CONST_SUFFIX,
  SELECTOR_DIR,
  SELECTOR_SUFFIX,
  methodsFor,
  type ElementFact,
  type PageFact,
} from "./structure.js";

/**
 * Render the client's page objects, selector maps and flows.
 *
 * Selectors live in their own module rather than inside the page class, and that
 * split is the single most important decision here. When a new build moves an
 * element, the only thing that is wrong is one string. Keeping selectors as data
 * makes that a one-line edit — by a human or by the tool — instead of a
 * regeneration of the class, which would discard anything anyone had added to
 * it by hand.
 */

export function renderSelectors(page: PageFact): string {
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
};
`;
}

export function renderPage(page: PageFact): string {
  const constName = selectorConst(page);
  const methods = page.elements.flatMap((element) => renderMethods(element, constName)).join("\n\n");
  const navigate = page.url
    ? `
  /** Open this page directly. */
  async open() {
    await browser.url(${JSON.stringify(page.url)});
    await this.waitUntilLoaded();
  }
`
    : "";

  return `import { BasePage } from './BasePage.js';
import { ${constName} } from '../${SELECTOR_DIR}/${page.slug}.${SELECTOR_SUFFIX}.js';

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

function renderMethods(element: ElementFact, constName: string): string[] {
  const locator = `${constName}.${element.property}`;
  const label = JSON.stringify(element.label);

  return methodsFor(element).map(({ name, interaction }) => {
    switch (interaction) {
      case "click":
        return `  async ${name}() {\n    await this.click(${locator}, ${label});\n  }`;
      case "type":
        return `  async ${name}(value) {\n    await this.type(${locator}, value, ${label});\n  }`;
      case "read":
        return `  async ${name}() {\n    return this.getText(${locator}, ${label});\n  }`;
      case "check":
        return `  async ${name}() {\n    return this.isVisible(${locator});\n  }`;
      case "wait":
        return `  async ${name}() {\n    await this.waitForGone(${locator});\n  }`;
    }
  });
}

/**
 * The base every page extends.
 *
 * Thin on purpose: it forwards to the framework runtime rather than
 * reimplementing it, so the waiting and the failure diagnostics are identical
 * whether a spec calls a page object or the helpers directly.
 */
export function renderBasePage(): string {
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
  async click(selector, label) {
    await wdio.click(selector, { label });
  }

  async type(selector, value, label) {
    await wdio.type(selector, value, { label });
  }

  async getText(selector, label) {
    return wdio.getText(selector, { label });
  }

  async isVisible(selector) {
    return wdio.isVisible(selector);
  }

  async waitForGone(selector) {
    await wdio.waitForGone(selector);
  }

  /** Override on a page that has a better readiness signal than the document. */
  async waitUntilLoaded() {
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
  parameters: string[];
  steps: Array<{ page: PageFact; method: string; argument?: string }>;
}): string {
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
export async function ${args.name}(${args.parameters.join(", ")}) {
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
