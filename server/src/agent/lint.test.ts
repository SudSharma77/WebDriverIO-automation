import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lintSpec } from "./lint.js";

const CLEAN_SPEC = `import { click, type, waitForPageLoad } from '@testlab/framework';

describe('Login', () => {
  it('logs in with valid credentials', async () => {
    await browser.url('https://example.com/');
    await waitForPageLoad();
    await type('#email', 'user@example.com', { label: 'the email field' });
    await click('button[type=submit]', { label: 'the sign in button' });
    await expect($('.dashboard')).toBeDisplayed();
  });
});
`;

describe("lintSpec", () => {
  // Regression: the linter was configured with `sourceType: "script"`, under
  // which the `import` line every generated spec starts with is a *fatal parse
  // error*. That produced a phantom issue on every single synthesis, which in
  // turn triggered a wasted "fix these lint issues" model call against code
  // that was perfectly valid. This test is the one whose absence hid that.
  it("reports no issues for a valid spec that imports the framework helpers", async () => {
    const result = await lintSpec(CLEAN_SPEC);
    assert.deepEqual(result.issues, [], `expected a clean spec to lint cleanly, got: ${result.issues.join("; ")}`);
  });

  it("never reports a parsing error for ESM syntax", async () => {
    const result = await lintSpec(CLEAN_SPEC);
    const parseErrors = result.issues.filter((issue) => /parsing error/i.test(issue));
    assert.deepEqual(parseErrors, []);
  });

  // The reason the lint pass exists at all: a missing `await` before expect()
  // returns a pending promise nobody checks, so the test "passes" without
  // having asserted anything. A prompt cannot reliably prevent this; a rule can.
  it("catches an unawaited expect, which would silently assert nothing", async () => {
    const missingAwait = CLEAN_SPEC.replace("await expect($('.dashboard'))", "expect($('.dashboard'))");
    const result = await lintSpec(missingAwait);
    assert.ok(
      result.issues.some((issue) => issue.includes("await-expect")) || result.code.includes("await expect"),
      `expected the unawaited expect to be flagged or fixed, got issues: ${result.issues.join("; ")}`,
    );
  });

  it("returns the code unchanged when there is nothing to fix", async () => {
    const result = await lintSpec(CLEAN_SPEC);
    assert.equal(result.code, CLEAN_SPEC);
  });
});

const TS_SPEC = `import { click, getText } from '@testlab/framework';

describe('Login', () => {
  it('signs in', async (): Promise<void> => {
    await click('#go', { label: 'the sign in button' });
    const heading: string = await getText('h1', { label: 'the page heading' });
    await expect(heading).toContain('Welcome');
    await expect($('.dashboard')).toBeDisplayed();
  });
});
`;

describe("lintSpec on TypeScript", () => {
  // Same failure as the sourceType bug, one layer along: the default parser
  // cannot read a type annotation, so every TypeScript spec would come back
  // with a parse error dressed up as a lint finding and burn a repair call.
  it("parses a TypeScript spec cleanly", async () => {
    const result = await lintSpec(TS_SPEC, "ts");
    assert.deepEqual(result.issues, [], `expected a clean TS spec to lint cleanly, got: ${result.issues.join("; ")}`);
  });

  it("would fail without the TypeScript parser, which is why it is selected by language", async () => {
    // Proves the parser choice is load-bearing rather than incidental.
    const result = await lintSpec(TS_SPEC, "js");
    assert.ok(
      result.issues.some((issue) => /parsing error/i.test(issue)),
      "expected the JavaScript parser to reject type annotations",
    );
  });

  it("still catches a real wdio issue in TypeScript", async () => {
    const missingAwait = TS_SPEC.replace("await expect($('.dashboard'))", "expect($('.dashboard'))");
    const result = await lintSpec(missingAwait, "ts");
    assert.ok(
      result.issues.some((issue) => issue.includes("await-expect")) || result.code.includes("await expect"),
      `expected the unawaited expect to be flagged or fixed, got: ${result.issues.join("; ")}`,
    );
  });
});
