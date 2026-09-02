import type { Platform } from "../types.js";

/**
 * Turning a verified flat spec into page objects, locators and flows.
 *
 * The whole partition is deterministic, which matters more here than anywhere
 * else in the system: this runs on every passing run, so any model call would
 * be a per-run cost sitting on the path whose entire purpose is to remove
 * per-run costs.
 *
 * Three signals make that possible, and all three are already in the spec:
 *
 *   `browser.url(...)`  marks a page boundary
 *   `label`             names the element
 *   the helper used     says what kind of method the element deserves
 */

/**
 * What the selector layer is called on disk.
 *
 * Kept as constants because the name appears in four places that must agree —
 * the directory, the file suffix, the exported constant, and the import written
 * into every generated page class. Renaming it is one edit here; changing any
 * one of them alone produces page objects that import a module nobody writes.
 */
export const SELECTOR_DIR = "selectors";
export const SELECTOR_SUFFIX = "selectors";
export const SELECTOR_CONST_SUFFIX = "Selectors";

/** How an element was interacted with, which decides the generated method. */
export type Interaction = "click" | "type" | "read" | "check" | "wait" | "dismiss";

export interface ElementFact {
  /** Human name from the spec, e.g. "the username field". */
  label: string;
  /** Identifier form, e.g. `usernameField`. */
  property: string;
  selector: string;
  interactions: Interaction[];
  /**
   * This element holds a credential, so anything typed into it must be kept
   * out of WebdriverIO's own command log.
   *
   * A property of the element, not of one call: a password field is a password
   * field every time it is touched. That is what lets the generated method
   * carry the flag itself, which in turn is what lets a masked field become a
   * page-object call instead of staying a raw selector in the spec forever
   * (see `pom.ts`).
   */
  masked?: boolean;
}

export interface PageFact {
  /** Class name, e.g. `LoginPage`. */
  className: string;
  /** Module basename, e.g. `login`. */
  slug: string;
  /** URL the page was observed at, when there was one. */
  url?: string;
  platform: Platform;
  elements: ElementFact[];
}

/**
 * Exported so the page-object rewrite (`pom.ts`) recognises exactly the same
 * call shapes this scanner does — the two must never drift, or the rewrite
 * could leave behind a raw call this file would have tracked, or vice versa.
 */
export const HELPER_INTERACTION: Record<string, Interaction> = {
  click: "click",
  type: "type",
  getText: "read",
  selectOption: "type",
  isVisible: "check",
  waitForGone: "wait",
  find: "check",
  dismissIfPresent: "dismiss",
};

/**
 * Split a spec into pages.
 *
 * Elements are attributed to the most recent `browser.url(...)` before them.
 * On mobile there is no URL, so everything lands on one screen named after the
 * scenario — still useful, since the alternative is no structure at all.
 */
export function partitionByPage(spec: string, platform: Platform, fallbackName: string): PageFact[] {
  const pages: PageFact[] = [];
  let current: PageFact | null = null;

  for (const event of scan(spec)) {
    if (event.kind === "navigate") {
      const slug = (event.url ? slugFromUrl(event.url) : event.slug) ?? slugify(fallbackName);
      current = findOrCreate(pages, slug, platform, event.url);
      continue;
    }

    if (!current) {
      current = findOrCreate(pages, slugify(fallbackName), platform, undefined);
    }

    const property = toProperty(event.label);
    if (!property) continue;

    const existing = current.elements.find((e) => e.label === event.label);
    if (existing) {
      if (!existing.interactions.includes(event.interaction)) existing.interactions.push(event.interaction);
      // Sticky: one masked call is enough to establish that this element holds
      // a credential. A later unmasked call on the same field is a mistake to
      // absorb, not a reason to start logging the value.
      if (event.masked) existing.masked = true;
      continue;
    }

    current.elements.push({
      label: event.label,
      property,
      selector: event.selector,
      interactions: [event.interaction],
      ...(event.masked ? { masked: true } : {}),
    });
  }

  return pages.filter((page) => page.elements.length > 0);
}

function findOrCreate(pages: PageFact[], slug: string, platform: Platform, url: string | undefined): PageFact {
  const existing = pages.find((p) => p.slug === slug);
  if (existing) return existing;

  const page: PageFact = { className: toClassName(slug), slug, platform, elements: [] };
  if (url) page.url = url;
  pages.push(page);
  return page;
}

type ScanEvent =
  | { kind: "navigate"; url?: string; slug?: string }
  | { kind: "element"; label: string; selector: string; interaction: Interaction; masked: boolean };

/**
 * Walk the spec in source order.
 *
 * Order is the point — an element belongs to whichever page was open when the
 * spec touched it, so a positional scan is not an implementation shortcut here,
 * it is the actual semantics.
 */
function* scan(source: string): Generator<ScanEvent> {
  const pattern = new RegExp(
    [
      "browser\\.url\\(\\s*(['\"`])([^'\"`]+)\\1",
      // A spec that has already been through the page-object rewrite navigates
      // via `homePage.open()` instead — see `rewriteNavigation` in pom.ts.
      // Without this, re-scanning such a file (which happens every time a
      // second scenario is nested into it) would see no page boundary at all
      // and attribute the new scenario's elements to a fallback screen.
      "\\b(\\w+)\\.open\\(\\s*\\)",
      `\\b(${Object.keys(HELPER_INTERACTION).join("|")})\\s*\\(`,
    ].join("|"),
    "g",
  );

  for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
    if (match[2]) {
      yield { kind: "navigate", url: match[2] };
      continue;
    }

    if (match[3]) {
      const slug = slugFromInstance(match[3]);
      if (slug) yield { kind: "navigate", slug };
      continue;
    }

    const helper = match[4];
    if (!helper) continue;

    // Guard against `page.click(` and `myClick(` — other people's functions.
    const before = source[match.index - 1];
    if (before !== undefined && /[\w$.]/.test(before)) continue;

    const args = balanced(source, pattern.lastIndex - 1);
    if (args === null) continue;

    const selector = firstStringLiteral(args);
    const label = labelArgument(args);
    if (selector && label) {
      yield {
        kind: "element",
        label,
        selector,
        interaction: HELPER_INTERACTION[helper]!,
        masked: MASK_OPTION.test(args),
      };
    }
  }
}

/**
 * Args (or body) text between a matching pair of parens, given the index of
 * the opening one. Skips over quoted strings — including backtick templates,
 * whose `${...}` interpolations could otherwise be mistaken for real nesting
 * — so a stray paren inside a string literal never throws off the count.
 * Exported: the same matcher is what makes it safe to find the exact extent
 * of an existing `describe(...)` call when splicing a new scenario into it.
 */
export function balanced(source: string, open: number): string | null {
  let depth = 0;
  let quote: string | null = null;

  for (let i = open; i < source.length; i++) {
    const char = source[i]!;
    if (quote) {
      if (char === "\\") i++;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }
    if (char === "(") depth++;
    else if (char === ")") {
      depth--;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return null;
}

function firstStringLiteral(args: string): string | null {
  return /^\s*(['"`])((?:[^\\]|\\.)*?)\1/.exec(args)?.[2] ?? null;
}

function labelArgument(args: string): string | null {
  return /\blabel\s*:\s*(['"`])((?:[^\\]|\\.)*?)\1/.exec(args)?.[2]?.trim() || null;
}

/**
 * `{ mask: true }` in the options bag. Shared with `pom.ts`, which has to
 * recognise exactly the same shape — the two scanners disagreeing would mean a
 * spec whose credential the rewrite treats one way and the page object the
 * other.
 */
export const MASK_OPTION = /\bmask\s*:\s*true\b/;

/**
 * `https://shop.example.com/checkout/payment` -> `checkout-payment`
 *
 * The path names the screen. A root URL has no path to name it by, so it
 * becomes `home`, which is what the screen almost always is.
 */
export function slugFromUrl(url: string): string | null {
  try {
    const segments = new URL(url).pathname.split("/").filter((s) => s && !/^\d+$/.test(s) && !s.includes("."));
    return segments.length === 0 ? "home" : slugify(segments.slice(0, 2).join("-"));
  } catch {
    return null;
  }
}

/** "the username field" -> `usernameField`. Articles carry no meaning. */
export function toProperty(label: string): string | null {
  const words = label
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((word, index) => !(index === 0 && (word === "the" || word === "a" || word === "an")));

  if (words.length === 0) return null;

  const identifier = words
    .map((word, index) => (index === 0 ? word : word[0]!.toUpperCase() + word.slice(1)))
    .join("");

  // A leading digit is not a valid identifier; prefix rather than drop, so the
  // element still gets a stable name.
  return /^[0-9]/.test(identifier) ? `element${identifier[0]!.toUpperCase()}${identifier.slice(1)}` : identifier;
}

export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .slice(0, 40)
      // Trimmed after truncating, not before: cutting at 40 characters can land
      // mid-word and leave a dangling separator, e.g. "…and-conditions-".
      .replace(/^-+|-+$/g, "") || "screen"
  );
}

/**
 * `checkoutPaymentPage` -> `checkout-payment`. The inverse of `toClassName`
 * followed by the instance-name convention, so a rewritten spec's `open()`
 * call resolves back to the same page this scanner would have created from the
 * URL. Returns null for anything that isn't a page instance — `foo.open()` on
 * some unrelated object must not invent a screen.
 */
function slugFromInstance(instance: string): string | null {
  if (!/^[a-z]\w*Page$/.test(instance)) return null;
  const base = instance.slice(0, -"Page".length);
  return slugify(base.replace(/([a-z0-9])([A-Z])/g, "$1-$2"));
}

/** `checkout-payment` -> `CheckoutPaymentPage` */
export function toClassName(slug: string): string {
  const base = slug
    .split("-")
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join("");
  return `${base || "Screen"}Page`;
}

/** The method a given interaction earns on the page object. */
export function methodsFor(element: ElementFact): Array<{ name: string; interaction: Interaction }> {
  const capital = element.property[0]!.toUpperCase() + element.property.slice(1);

  return element.interactions.map((interaction) => {
    switch (interaction) {
      case "click":
        return { name: `click${capital}`, interaction };
      case "type":
        return { name: `enter${capital}`, interaction };
      case "read":
        return { name: `get${capital}Text`, interaction };
      case "check":
        return { name: `is${capital}Visible`, interaction };
      case "wait":
        return { name: `waitFor${capital}ToDisappear`, interaction };
      case "dismiss":
        return { name: `dismiss${capital}`, interaction };
    }
  });
}
