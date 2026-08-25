import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nestScenario } from "./nest.js";
import { finalizeImports, rewriteToPageObjects } from "./pom.js";
import { partitionByPage } from "./structure.js";

/**
 * The scanners in structure.ts, pom.ts and nest.ts are brace- and
 * quote-depth matchers, not parsers, and every one of them was written and
 * tested against plain JavaScript. Now that generated specs are TypeScript,
 * this file is the evidence that they still behave — using the syntax a
 * generated spec can realistically contain, not a synthetic worst case.
 *
 * The failure that matters most here is silent: when a scanner stops
 * recognising a call, the pipeline leaves it alone by design, so a spec keeps
 * its raw selectors and nothing reports a problem. Every test below therefore
 * asserts the rewrite *happened*, not merely that the output is well-formed.
 */

const TS_SPEC = `import { click, type, getText, waitForPageLoad } from '@testlab/framework';

describe('login', () => {
  it('signs in', async (): Promise<void> => {
    await browser.url('https://example.com/');
    await waitForPageLoad();

    await click('button*=Confirm', { label: 'the consent banner' });
    await type('#email', process.env.TESTLAB_SECRET_EMAIL, { label: 'the email field' });

    const heading: string = await getText('h1', { label: 'the page heading' });
    await expect(heading).toContain('Welcome');
  });
});
`;

describe("partitionByPage on TypeScript", () => {
  const pages = partitionByPage(TS_SPEC, "web", "login");

  it("still finds every element despite the type annotations around them", () => {
    assert.equal(pages.length, 1);
    assert.deepEqual(
      pages[0]!.elements.map((e) => e.property),
      ["consentBanner", "emailField", "pageHeading"],
    );
  });

  it("is not confused by a typed arrow callback's return annotation", () => {
    // `async (): Promise<void> => {}` puts a `<`/`>` pair and a `(` `)` pair
    // between describe() and the first helper call.
    assert.equal(pages[0]!.elements[0]!.selector, "button*=Confirm");
  });
});

describe("rewriteToPageObjects on TypeScript", () => {
  it("rewrites calls into page-object methods", () => {
    const pages = partitionByPage(TS_SPEC, "web", "login");
    const result = rewriteToPageObjects(TS_SPEC, pages);
    assert.ok(result, "the rewrite declined a TypeScript spec entirely");
    assert.match(result!.code, /homePage\.clickConsentBanner\(\)/);
    assert.match(result!.code, /homePage\.enterEmailField\(process\.env\.TESTLAB_SECRET_EMAIL\)/);
  });

  it("survives an `as` cast in a helper argument by leaving that call alone", () => {
    // firstStringLiteral anchors on a whole-argument string, so a cast makes
    // the selector unrecognisable. The contract is "leave it exactly as it
    // was", never "guess" - and never corrupt the surrounding file.
    const withCast = TS_SPEC.replace("click('button*=Confirm'", "click('button*=Confirm' as string");
    const pages = partitionByPage(withCast, "web", "login");
    const result = rewriteToPageObjects(withCast, pages);
    assert.ok(result);
    assert.match(result!.code, /'button\*=Confirm' as string/);
  });

  it("is not thrown off by a generic type argument on \\$()", () => {
    const withGeneric = TS_SPEC.replace(
      "await expect(heading).toContain('Welcome');",
      "await expect($<HTMLElement>('#done')).toBeDisplayed();",
    );
    const pages = partitionByPage(withGeneric, "web", "login");
    const result = rewriteToPageObjects(withGeneric, pages);
    assert.ok(result, "an unbalanced <> would have made the rewrite bail");
    assert.match(result!.code, /homePage\.clickConsentBanner\(\)/);
  });
});

describe("finalizeImports on TypeScript", () => {
  it("prunes helpers that no longer have a call, as before", () => {
    const pages = partitionByPage(TS_SPEC, "web", "login");
    const result = rewriteToPageObjects(TS_SPEC, pages)!;
    const finalized = finalizeImports(result.code, result.pagesUsed);

    assert.doesNotMatch(finalized, /\bclick,/);
    // Every helper this fixture used is now covered by a page-object method —
    // including the navigation and its wait — so the import goes entirely.
    // That state is exactly what `nestScenario` must keep tolerating.
    assert.doesNotMatch(finalized, /@testlab\/framework/);
  });

  // Regression: a type-only specifier is used in an annotation, never a call,
  // so the "is it still called?" filter concluded it was dead and deleted it -
  // leaving a file referencing a type it no longer imports.
  it("keeps an inline type-only specifier that no call site can vouch for", () => {
    const withTypeImport = TS_SPEC.replace(
      "import { click, type, getText, waitForPageLoad } from '@testlab/framework';",
      "import { click, type, getText, waitForPageLoad, type FindOptions } from '@testlab/framework';",
    );
    const pages = partitionByPage(withTypeImport, "web", "login");
    const result = rewriteToPageObjects(withTypeImport, pages)!;
    const finalized = finalizeImports(result.code, result.pagesUsed);

    assert.match(finalized, /type FindOptions/, "a type-only import was dropped as if it were dead code");
  });

  it("leaves a separate `import type` line untouched", () => {
    const withTypeLine = `import type { FindOptions } from '@testlab/framework';\n${TS_SPEC}`;
    const pages = partitionByPage(withTypeLine, "web", "login");
    const result = rewriteToPageObjects(withTypeLine, pages)!;
    const finalized = finalizeImports(result.code, result.pagesUsed);

    assert.match(finalized, /import type \{ FindOptions \} from '@testlab\/framework';/);
  });

  it("adds the page import with a .js specifier, as NodeNext requires", () => {
    const pages = partitionByPage(TS_SPEC, "web", "login");
    const result = rewriteToPageObjects(TS_SPEC, pages)!;
    const finalized = finalizeImports(result.code, result.pagesUsed);

    assert.match(finalized, /from '\.\.\/\.\.\/src\/pages\/HomePage\.js'/);
  });
});

describe("nesting a second TypeScript scenario", () => {
  const SECOND = `import { click, waitForPageLoad } from '@testlab/framework';

describe('login', () => {
  it('signs out again', async (): Promise<void> => {
    await browser.url('https://example.com/');
    await waitForPageLoad();
    await click('#signout', { label: 'the sign out link' });
    await expect(browser).toHaveUrl('https://example.com/', { containing: true });
  });
});
`;

  it("splices into an existing TypeScript describe block", () => {
    const nested = nestScenario(TS_SPEC, SECOND);
    assert.ok(nested, "nesting declined a TypeScript spec");
    assert.match(nested!, /it\('signs in'/);
    assert.match(nested!, /it\('signs out again'/);
    assert.equal(nested!.match(/describe\(/g)?.length, 1, "nesting produced a second describe block");
  });

  // The composition that matters in production: a file is written, rewritten
  // into page-object calls, then a later run nests another scenario into it and
  // the whole thing is rewritten again.
  it("still rewrites cleanly after nesting, without duplicating the page import", () => {
    const firstPages = partitionByPage(TS_SPEC, "web", "login");
    const firstPass = finalizeImports(
      rewriteToPageObjects(TS_SPEC, firstPages)!.code,
      rewriteToPageObjects(TS_SPEC, firstPages)!.pagesUsed,
    );

    const nested = nestScenario(firstPass, SECOND);
    assert.ok(nested, "nesting declined an already-rewritten TypeScript spec");

    const allPages = partitionByPage(nested!, "web", "login");
    const second = rewriteToPageObjects(nested!, allPages)!;
    const finalized = finalizeImports(second.code, second.pagesUsed);

    const pageImports = finalized.match(/from '\.\.\/\.\.\/src\/pages\/HomePage\.js'/g) ?? [];
    assert.equal(pageImports.length, 1, `expected exactly one HomePage import, found ${pageImports.length}`);
    assert.match(finalized, /it\('signs in'/);
    assert.match(finalized, /it\('signs out again'/);
  });
});
