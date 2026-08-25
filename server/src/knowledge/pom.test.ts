import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { finalizeImports, rewriteToPageObjects } from "./pom.js";
import { partitionByPage } from "./structure.js";

const SPEC = `import { click, type, getText, isVisible, waitForGone, waitForPageLoad, dismissIfPresent } from '@testlab/framework';

describe('login with credentials', () => {
  it('should login with credentials', async () => {
    await browser.url('https://www.iwanttfc.com/');
    await waitForPageLoad();

    await click('button*=Confirm', { label: 'Confirm cookie banner' });
    await type('input[name="userEmail"]', process.env.TESTLAB_SECRET_EMAIL, { label: 'userEmail input' });

    const passwordInput = $('input[name="userPassword"]');
    await passwordInput.waitForDisplayed();
    await passwordInput.setValue(process.env.TESTLAB_SECRET_PASSWORD, { mask: true });

    await click('button*=Continue', { label: 'Continue button' });
    await waitForPageLoad();

    const searchInput = $('input[placeholder*="Search by title"]');
    await expect(searchInput).toExist();
  });
});
`;

describe("rewriteToPageObjects", () => {
  it("replaces recognised helper calls with the matching page-object method", () => {
    const pages = partitionByPage(SPEC, "web", "login with credentials");
    const result = rewriteToPageObjects(SPEC, pages)!;
    assert.ok(result, "expected a rewrite, got null");

    assert.match(result.code, /await homePage\.clickConfirmCookieBanner\(\);/);
    assert.match(result.code, /await homePage\.enterUseremailInput\(process\.env\.TESTLAB_SECRET_EMAIL\);/);
    assert.match(result.code, /await homePage\.clickContinueButton\(\);/);
  });

  it("leaves a masked credential field completely untouched", () => {
    // Dropping `mask` would put the value back into WebdriverIO's own command
    // log - this call must survive byte-for-byte, not just "work".
    const pages = partitionByPage(SPEC, "web", "login with credentials");
    const result = rewriteToPageObjects(SPEC, pages)!;
    assert.match(result.code, /passwordInput\.setValue\(process\.env\.TESTLAB_SECRET_PASSWORD, \{ mask: true \}\);/);
  });

  it("leaves an unrecognised call (raw $()/.waitForDisplayed()) untouched", () => {
    const pages = partitionByPage(SPEC, "web", "login with credentials");
    const result = rewriteToPageObjects(SPEC, pages)!;
    assert.match(result.code, /const passwordInput = \$\('input\[name="userPassword"\]'\);/);
    assert.match(result.code, /await passwordInput\.waitForDisplayed\(\);/);
  });

  it("only reports pages actually used by a surviving rewrite", () => {
    const pages = partitionByPage(SPEC, "web", "login with credentials");
    const result = rewriteToPageObjects(SPEC, pages)!;
    assert.equal(result.pagesUsed.length, 1);
    assert.equal(result.pagesUsed[0]!.className, "HomePage");
  });

  it("produces braces-and-quotes-balanced output", () => {
    const pages = partitionByPage(SPEC, "web", "login with credentials");
    const result = rewriteToPageObjects(SPEC, pages)!;
    const opens = (result.code.match(/\{/g) ?? []).length;
    const closes = (result.code.match(/\}/g) ?? []).length;
    assert.equal(opens, closes);
  });

  it("declines rather than guesses when no page knows the selector used", () => {
    const result = rewriteToPageObjects(SPEC, []); // no elements known at all
    // Nothing maps, so every call is left as-is - not null, just an
    // unchanged copy; confirm it really is unchanged rather than corrupted.
    assert.ok(result);
    assert.equal(result!.code, SPEC);
    assert.equal(result!.pagesUsed.length, 0);
  });
});

const MASKED_SPEC = `import { type, click, waitForPageLoad } from '@testlab/framework';

describe('login', () => {
  it('signs in', async () => {
    await browser.url('https://shop.example.com/');
    await waitForPageLoad();
    await type('#email', process.env.TESTLAB_SECRET_EMAIL, { label: 'the email field' });
    await type('#password', process.env.TESTLAB_SECRET_PASSWORD, { label: 'the password field', mask: true });
    await click('#go', { label: 'the sign in button' });
    await expect(browser).toHaveUrl('https://shop.example.com/', { containing: true });
  });
});
`;

describe("rewriteToPageObjects — credential fields", () => {
  // This used to be refused outright: the page-object method had no way to
  // carry `mask`, so dropping it would have logged the password. The flag now
  // lives on the element, so the call rewrites like any other and the spec
  // stops being the only place that selector appears.
  it("rewrites a masked credential field like any other call", () => {
    const pages = partitionByPage(MASKED_SPEC, "web", "login");
    const result = rewriteToPageObjects(MASKED_SPEC, pages)!;

    assert.match(result.code, /await homePage\.enterPasswordField\(process\.env\.TESTLAB_SECRET_PASSWORD\);/);
    assert.doesNotMatch(result.code, /#password/, "the credential selector is still inline in the spec");
  });

  it("records the field as masked so the generated method can carry the flag", () => {
    const pages = partitionByPage(MASKED_SPEC, "web", "login");
    const password = pages[0]!.elements.find((e) => e.property === "passwordField");
    const email = pages[0]!.elements.find((e) => e.property === "emailField");

    assert.equal(password?.masked, true);
    assert.notEqual(email?.masked, true, "an ordinary field must not be marked as a credential");
  });

  it("leaves no selector literal anywhere in the rewritten spec", () => {
    const pages = partitionByPage(MASKED_SPEC, "web", "login");
    const result = rewriteToPageObjects(MASKED_SPEC, pages)!;
    for (const selector of ["#email", "#password", "#go"]) {
      assert.doesNotMatch(result.code, new RegExp(selector), `${selector} survived in the spec`);
    }
  });
});

describe("rewriteToPageObjects — navigation", () => {
  it("replaces browser.url with the page's own open()", () => {
    const pages = partitionByPage(MASKED_SPEC, "web", "login");
    const result = rewriteToPageObjects(MASKED_SPEC, pages)!;

    assert.match(result.code, /await homePage\.open\(\);/);
    assert.doesNotMatch(result.code, /browser\.url\(/);
  });

  it("drops the wait that open() already performs", () => {
    const pages = partitionByPage(MASKED_SPEC, "web", "login");
    const result = rewriteToPageObjects(MASKED_SPEC, pages)!;
    assert.doesNotMatch(result.code, /waitForPageLoad\(\)/);
  });

  it("leaves a navigation no page object covers exactly as it was", () => {
    const elsewhere = MASKED_SPEC.replace(
      "await click('#go', { label: 'the sign in button' });",
      "await browser.url('https://other.example.com/');\n    await click('#go', { label: 'the sign in button' });",
    );
    const pages = partitionByPage(elsewhere, "web", "login");
    const result = rewriteToPageObjects(elsewhere, pages)!;

    // The second URL did get its own PageFact, but it has no elements of its
    // own and so no open() to call — the navigation must survive untouched
    // rather than be rewritten to a method that was never generated.
    assert.match(result.code, /browser\.url\('https:\/\/other\.example\.com\/'\)/);
  });

  // partitionByPage finds page boundaries by looking for browser.url. Once
  // navigation is rewritten, re-scanning that file (which happens every time a
  // second scenario is nested into it) must still find the boundary, or the
  // new scenario's elements get attributed to a fallback screen.
  it("stays recognisable as a page boundary when the file is scanned again", () => {
    const pages = partitionByPage(MASKED_SPEC, "web", "login");
    const rewritten = rewriteToPageObjects(MASKED_SPEC, pages)!.code;

    const rescanned = partitionByPage(rewritten, "web", "login");
    assert.deepEqual(
      rescanned.map((p) => p.slug),
      [],
      "a fully rewritten spec has no raw calls left, so no elements — but it must not invent a fallback page either",
    );

    const raw = "await click('#extra', { label: 'the extra button' });";
    const withNewCall = rewritten.replace(
      "await homePage.clickSignInButton();",
      `await homePage.clickSignInButton();\n    ${raw}`,
    );
    assert.ok(withNewCall.includes(raw), "fixture did not actually gain a nested raw call");

    const merged = partitionByPage(withNewCall, "web", "login");
    assert.deepEqual(merged.map((p) => p.slug), ["home"], "the nested scenario's element landed on a fallback screen");
  });
});

describe("finalizeImports", () => {
  it("drops a framework helper with no remaining call", () => {
    const pages = partitionByPage(SPEC, "web", "login with credentials");
    const result = rewriteToPageObjects(SPEC, pages)!;
    const finalized = finalizeImports(result.code, result.pagesUsed);

    assert.doesNotMatch(finalized, /\bclick,/);
    assert.doesNotMatch(finalized, /\btype,/);
    assert.doesNotMatch(finalized, /\bdismissIfPresent\b/);
  });

  // The fixture waits twice: once right after navigating (redundant, since
  // `open()` waits for the caller) and once after submitting (a real wait
  // nothing else covers). Pruning must take the first and keep the second.
  it("keeps a framework helper still called directly (waitForPageLoad)", () => {
    const pages = partitionByPage(SPEC, "web", "login with credentials");
    const result = rewriteToPageObjects(SPEC, pages)!;
    const finalized = finalizeImports(result.code, result.pagesUsed);

    assert.match(finalized, /import \{ waitForPageLoad \} from '@testlab\/framework';/);
    assert.equal(
      (finalized.match(/await waitForPageLoad\(\)/g) ?? []).length,
      1,
      "the wait made redundant by open() should have gone, and only that one",
    );
  });

  it("adds one import per page object the rewrite used", () => {
    const pages = partitionByPage(SPEC, "web", "login with credentials");
    const result = rewriteToPageObjects(SPEC, pages)!;
    const finalized = finalizeImports(result.code, result.pagesUsed);

    assert.match(finalized, /import \{ homePage \} from '\.\.\/\.\.\/src\/pages\/HomePage\.js';/);
  });

  // Regression: nesting a second scenario into an already-rewritten file
  // reintroduces that scenario's own raw calls (see nest.ts), which get
  // rewritten again on the next save — finalizeImports must not add a second
  // copy of an import the file already has from the first scenario's pass.
  it("does not duplicate a page import already present in the file", () => {
    const pages = partitionByPage(SPEC, "web", "login with credentials");
    const alreadyRewritten = `import { homePage } from '../../src/pages/HomePage.js';\n\n${SPEC}`;
    const result = rewriteToPageObjects(alreadyRewritten, pages)!;
    const finalized = finalizeImports(result.code, result.pagesUsed);

    const occurrences = finalized.match(/from '\.\.\/\.\.\/src\/pages\/HomePage\.js'/g) ?? [];
    assert.equal(occurrences.length, 1, `expected exactly one HomePage import, found ${occurrences.length}`);
  });
});
