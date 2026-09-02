import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ensureEsmImports, inventedExpectations } from "./specChecks.js";

describe("ensureEsmImports", () => {
  it("rewrites a destructured require into a static named import", () => {
    const code = `const { click, type, isVisible } = require('@testlab/framework');\n\ndescribe('x', () => {});`;
    assert.equal(
      ensureEsmImports(code),
      `import { click, type, isVisible } from '@testlab/framework';\n\ndescribe('x', () => {});`,
    );
  });

  it("rewrites a default-binding require", () => {
    assert.equal(
      ensureEsmImports(`const helpers = require("@testlab/framework");`),
      `import helpers from '@testlab/framework';`,
    );
  });

  it("rewrites a bare require statement into a side-effect import", () => {
    assert.equal(ensureEsmImports(`require('@testlab/framework');`), `import '@testlab/framework';`);
  });

  it("leaves existing ESM imports untouched", () => {
    const code = `import { click } from '@testlab/framework';\nconst x = 1;`;
    assert.equal(ensureEsmImports(code), code);
  });

  it("does not touch a call embedded in a larger expression", () => {
    const code = `const names = ['a'].map((n) => require(n));`;
    assert.equal(ensureEsmImports(code), code);
  });
});

describe("inventedExpectations", () => {
  const evidence = [
    "Test: Login with valid credentials then logout",
    "Target: web https://www.iwanttfc.com/",
    "Expected Result:",
    "- UNVERIFIED: exploration ended before the outcome was observed",
    "The page title was Stream Filipino Movies & TV Shows | iWant",
    "browser.url('https://www.iwanttfc.com/')",
  ].join("\n");

  it("flags a title that appears nowhere in the evidence", () => {
    const spec = `await expect(browser).toHaveTitle('The Internet');`;
    assert.deepEqual(inventedExpectations(spec, evidence), [{ value: "The Internet", matcher: "toHaveTitle" }]);
  });

  it("accepts a value the evidence actually observed", () => {
    const spec = `await expect(browser).toHaveTitle('Stream Filipino Movies & TV Shows   | iWant');`;
    assert.deepEqual(inventedExpectations(spec, evidence), []);
  });

  it("ignores non-literal arguments", () => {
    const spec = `await expect(browser).toHaveTitle(expectedTitle);`;
    assert.deepEqual(inventedExpectations(spec, evidence), []);
  });

  it("checks urls too", () => {
    const spec = `await expect(browser).toHaveUrl('https://the-internet.herokuapp.com/login');`;
    assert.equal(inventedExpectations(spec, evidence).length, 1);
  });

  it("returns nothing when there is no real evidence to check against", () => {
    const spec = `await expect(browser).toHaveTitle('Anything At All');`;
    assert.deepEqual(inventedExpectations(spec, ""), []);
    assert.deepEqual(inventedExpectations(spec, "short"), []);
  });

  it("reports each invented value once", () => {
    const spec = `await expect(browser).toHaveTitle('The Internet');\nawait expect(browser).toHaveTitle('The Internet');`;
    assert.equal(inventedExpectations(spec, evidence).length, 1);
  });
});
