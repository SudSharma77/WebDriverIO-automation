import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractCallSequence, findSharedPrefix } from "./flow.js";
import { rewriteToPageObjects } from "./pom.js";
import { partitionByPage } from "./structure.js";
import type { SpecRecord } from "./types.js";

const SPEC = `import { click, type } from '@testlab/framework';

describe('login with credentials', () => {
  it('should login with credentials', async () => {
    await browser.url('https://www.iwanttfc.com/');
    await click('button*=Confirm', { label: 'Confirm cookie banner' });
    await type('input[name="userEmail"]', process.env.TESTLAB_SECRET_EMAIL, { label: 'userEmail input' });
    await click('button*=Continue', { label: 'Continue button' });
  });
});
`;

function record(overrides: Partial<SpecRecord>): SpecRecord {
  return {
    file: "other.web.spec.js",
    prompt: "some other scenario",
    title: "Other scenario",
    platform: "web",
    target: "https://www.iwanttfc.com/",
    createdAt: 0,
    lastVerified: 0,
    passCount: 1,
    requiresSecrets: [],
    ...overrides,
  };
}

describe("extractCallSequence", () => {
  it("reads page-object calls off a rewritten spec, in order", () => {
    const pages = partitionByPage(SPEC, "web", "login with credentials");
    const rewrite = rewriteToPageObjects(SPEC, pages)!;
    const sequence = extractCallSequence(rewrite.code, rewrite.pagesUsed);

    // `open()` leads the sequence because navigation is itself a page-object
    // call once rewritten — and it belongs here: two scenarios that start on
    // different pages are not the same flow, however similar their next steps.
    assert.deepEqual(sequence, [
      "homePage.open",
      "homePage.clickConfirmCookieBanner",
      "homePage.enterUseremailInput",
      "homePage.clickContinueButton",
    ]);
  });

  it("returns nothing for a spec still full of raw selector calls", () => {
    // No PageFacts known at all - rewriteToPageObjects leaves it untouched.
    assert.deepEqual(extractCallSequence(SPEC, []), []);
  });
});

describe("findSharedPrefix", () => {
  const sequence = ["homePage.clickConfirmCookieBanner", "homePage.enterUseremailInput", "homePage.clickContinueButton"];

  it("finds a prior spec that opens with the same steps", () => {
    const prior = record({ callSequence: [...sequence, "homePage.clickSearchBar"] });
    const result = findSharedPrefix(sequence, [prior]);
    assert.ok(result);
    assert.deepEqual(result!.steps, sequence);
    assert.equal(result!.matchedSpec, prior);
  });

  it("ignores a match shorter than the minimum worth naming a function for", () => {
    const prior = record({ callSequence: [sequence[0]!, "homePage.clickSomethingElse"] });
    assert.equal(findSharedPrefix(sequence, [prior]), null);
  });

  it("only compares prefixes, not a shared run in the middle", () => {
    // Same last three steps, different first step - not a shared *opening*.
    const prior = record({
      callSequence: ["homePage.clickSomethingElse", ...sequence],
    });
    assert.equal(findSharedPrefix(sequence, [prior]), null);
  });

  it("picks the longest match when several prior specs qualify", () => {
    const shorter = record({ file: "shorter.web.spec.js", callSequence: sequence.slice(0, 2) });
    const longer = record({ file: "longer.web.spec.js", callSequence: [...sequence, "homePage.clickSearchBar"] });
    const result = findSharedPrefix(sequence, [shorter, longer]);
    assert.equal(result!.matchedSpec.file, "longer.web.spec.js");
  });

  it("skips a spec with no callSequence of its own", () => {
    const prior = record({ callSequence: undefined });
    assert.equal(findSharedPrefix(sequence, [prior]), null);
  });
});
