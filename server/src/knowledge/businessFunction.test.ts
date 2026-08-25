import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractBusinessFunctions, flowName } from "./businessFunction.js";
import { finalizeImports, rewriteToPageObjects } from "./pom.js";
import { partitionByPage } from "./structure.js";
import type { ExtractedFlow } from "./businessFunction.js";
import type { FlowRecord, ProjectLanguage } from "./types.js";

const RAW = `import { click, type, getText, waitForPageLoad } from '@testlab/framework';

describe('log in with valid credentials', () => {
  it('log in with valid credentials', async () => {
    await browser.url('https://shop.example.com/');
    await waitForPageLoad();

    // 1. Enter the email
    await type('#email', process.env.TESTLAB_SECRET_EMAIL, { label: 'the email field' });
    await type('#password', process.env.TESTLAB_SECRET_PASSWORD, { label: 'the password field', mask: true });
    await click('#go', { label: 'the sign in button' });

    const heading = await getText('h1', { label: 'the page heading' });
    await expect(heading).toBe('Welcome back');
  });
});
`;

/** The flow module's text, when one was written at all (it isn't, on reuse). */
function sourceOf(flow: { source: string | null } | null): string {
  assert.ok(flow?.source, "expected a new flow module to have been written");
  return flow.source;
}

/** The pipeline as `recordSuccess` runs it: partition, rewrite, then lift. */
function lift(spec: string, title = "log in with valid credentials", language: ProjectLanguage = "ts") {
  const pages = partitionByPage(spec, "web", title);
  const rewrite = rewriteToPageObjects(spec, pages)!;
  const rewritten = finalizeImports(rewrite.code, rewrite.pagesUsed);
  return single(extractBusinessFunctions({ spec: rewritten, pages, language }));
}

/** The old single-scenario view: these fixtures all hold exactly one it(). */
function single(extraction: { spec: string; flows: ExtractedFlow[] } | null) {
  if (!extraction) return null;
  assert.equal(extraction.flows.length, 1, "fixture was expected to hold exactly one scenario");
  return { ...extraction.flows[0]!, spec: extraction.spec };
}

describe("extractBusinessFunction", () => {
  it("lifts the steps into a named flow and leaves the assertion in the spec", () => {
    const flow = lift(RAW)!;
    assert.ok(flow, "extraction declined a spec of exactly the shape synthesis emits");

    assert.equal(flow.name, "logInWithValidCredentials");
    assert.match(sourceOf(flow), /export async function logInWithValidCredentials/);
    assert.match(sourceOf(flow), /await homePage\.clickSignInButton\(\);/);
    assert.match(flow.spec, /await expect\(outcome\.heading\)\.toBe\('Welcome back'\);/);
  });

  // The whole point of the layer: a spec says which scenario and what should
  // be true, and nothing about how.
  it("leaves the spec with no page objects, no selectors and no waits", () => {
    const flow = lift(RAW)!;

    assert.doesNotMatch(flow.spec, /homePage\./, "the spec still reaches into a page object");
    assert.doesNotMatch(flow.spec, /#email|#password|#go|'h1'/, "a selector survived in the spec");
    assert.doesNotMatch(flow.spec, /browser\.url|waitForPageLoad/, "the spec still drives navigation itself");
    assert.doesNotMatch(flow.spec, /@testlab\/framework/, "the spec still imports element helpers");
  });

  it("imports exactly the flow it calls", () => {
    const flow = lift(RAW)!;
    assert.match(flow.spec, /^import \{ logInWithValidCredentials \} from '\.\.\/\.\.\/src\/flows\/logInWithValidCredentials\.js';/);
    assert.equal((flow.spec.match(/^import /gm) ?? []).length, 1);
  });

  // A business function returns observations; the spec asserts on them.
  it("turns each read into an output field the spec asserts on", () => {
    const flow = lift(RAW)!;

    assert.deepEqual(flow.outputFields, ["heading"]);
    // `string`, not `string | boolean`: the method this read came from was
    // generated for a getText interaction, so the type is known exactly.
    assert.match(sourceOf(flow), /export interface LogInWithValidCredentialsOutput \{\n  heading: string;\n\}/);
    assert.match(sourceOf(flow), /return \{ heading \};/);
    assert.doesNotMatch(sourceOf(flow), /expect\(/, "the flow asserts, which belongs to the spec");
  });

  it("turns values the flow cannot know into inputs, and keeps literals inside", () => {
    const withLiteral = RAW.replace(
      "await click('#go', { label: 'the sign in button' });",
      "await type('#search', 'laptops', { label: 'the search field' });\n    await click('#go', { label: 'the sign in button' });",
    );
    const flow = lift(withLiteral)!;

    assert.deepEqual(flow.inputFields.sort(), ["emailField", "passwordField"]);
    assert.match(flow.spec, /emailField: process\.env\.TESTLAB_SECRET_EMAIL,/);
    // The search term is part of what this flow *is*, not something every
    // caller has to keep supplying.
    assert.match(sourceOf(flow), /await homePage\.enterSearchField\('laptops'\);/);
  });

  it("narrates itself, so a failure three calls deep says which flow was running", () => {
    const flow = lift(RAW)!;
    assert.match(sourceOf(flow), /step\("log in with valid credentials"\);/);
  });

  it("types a visibility check as a boolean rather than a string", () => {
    const withCheck = RAW.replace(
      "const heading = await getText('h1', { label: 'the page heading' });\n    await expect(heading).toBe('Welcome back');",
      "const bannerShown = await isVisible('.banner', { label: 'the welcome banner' });\n    await expect(bannerShown).toBe(true);",
    ).replace("import { click, type, getText, waitForPageLoad }", "import { click, type, isVisible, waitForPageLoad }");
    const flow = lift(withCheck)!;

    assert.match(sourceOf(flow), /bannerShown: boolean;/);
  });

  it("records the call sequence, which is how a later scenario finds this flow again", () => {
    const flow = lift(RAW)!;
    assert.deepEqual(flow.callSequence, [
      "homePage.open",
      "homePage.enterEmailField",
      "homePage.enterPasswordField",
      "homePage.clickSignInButton",
      "homePage.getPageHeadingText",
    ]);
  });
});

describe("extractBusinessFunctions — a file with several scenarios", () => {
  const TWO = RAW.replace(
    "  });\n});",
    `  });

  it('search the catalogue', async () => {
    await browser.url('https://shop.example.com/');
    await type('#search', 'laptops', { label: 'the search field' });
    await click('#go', { label: 'the sign in button' });
    const heading = await getText('h1', { label: 'the page heading' });
    await expect(heading).toBe('Results');
  });
});`,
  );

  function liftAll(spec: string) {
    const pages = partitionByPage(spec, "web", "shop");
    const rewrite = rewriteToPageObjects(spec, pages)!;
    const rewritten = finalizeImports(rewrite.code, rewrite.pagesUsed);
    return extractBusinessFunctions({ spec: rewritten, pages, language: "ts" });
  }

  // A spec file accumulates: a later run nests a second scenario into the file
  // its page already owns. Treating the file as all-or-nothing would leave one
  // scenario calling a flow and the next still calling page objects.
  it("lifts every scenario, not only the first", () => {
    const extraction = liftAll(TWO)!;
    assert.deepEqual(
      extraction.flows.map((f) => f.name).sort(),
      ["logInWithValidCredentials", "searchTheCatalogue"],
    );
  });

  it("names each flow after its own scenario", () => {
    const extraction = liftAll(TWO)!;
    assert.match(extraction.spec, /await logInWithValidCredentials\(/);
    assert.match(extraction.spec, /await searchTheCatalogue\(/);
    assert.doesNotMatch(extraction.spec, /homePage\./, "a scenario was left calling page objects");
  });

  // Re-running over an already-lifted file must be a no-op, since every save
  // re-runs the whole pipeline over whatever is on disk.
  it("leaves an already-lifted file alone", () => {
    const once = liftAll(TWO)!;
    const pages = partitionByPage(once.spec, "web", "shop");
    assert.equal(extractBusinessFunctions({ spec: once.spec, pages, language: "ts" }), null);
  });

  // Regression: a later run lifts only the scenario it just added, and used to
  // rewrite the import block from that scenario alone — leaving the file
  // calling the earlier flow with no import for it.
  it("keeps the import for a flow an earlier run already lifted", () => {
    const oneScenario = liftAll(RAW)!;

    // A second scenario arrives and is nested in, raw, as `nestScenario` does:
    // spliced in just before the describe block's closing brace.
    const closeDescribe = oneScenario.spec.lastIndexOf("});");
    assert.notEqual(closeDescribe, -1, "fixture is not shaped like a describe block");
    const nested =
      oneScenario.spec.slice(0, closeDescribe) +
      `
  it('search the catalogue', async () => {
    await homePage.open();
    await homePage.enterSearchField('laptops');
    await homePage.clickSignInButton();
    const heading = await homePage.getPageHeadingText();
    await expect(heading).toBe('Results');
  });
` +
      oneScenario.spec.slice(closeDescribe);

    const pages = partitionByPage(
      RAW.replace("await click('#go'", "await type('#search', 'laptops', { label: 'the search field' });\n    await click('#go'"),
      "web",
      "shop",
    );
    const again = extractBusinessFunctions({ spec: nested, pages, language: "ts" })!;

    assert.ok(again, "the newly nested scenario was not lifted");
    assert.match(again.spec, /import \{ logInWithValidCredentials \} from/, "dropped the earlier scenario's flow import");
    assert.match(again.spec, /import \{ searchTheCatalogue \} from/);
  });
});

describe("extractBusinessFunctions — when it must decline", () => {

  // Moving the steps into a flow would run this assertion after all of them.
  it("declines when an assertion sits between two steps", () => {
    const interleaved = RAW.replace(
      "await click('#go', { label: 'the sign in button' });",
      "await expect(browser).toHaveUrl('https://shop.example.com/');\n    await click('#go', { label: 'the sign in button' });",
    );
    assert.equal(lift(interleaved), null);
  });

  it("declines a statement it does not recognise rather than dropping it", () => {
    const handWritten = RAW.replace(
      "const heading = await getText('h1', { label: 'the page heading' });",
      "const heading = await $('h1').getText();",
    );
    assert.equal(lift(handWritten), null);
  });

  it("declines a spec whose calls were never rewritten into page objects", () => {
    const pages = partitionByPage(RAW, "web", "login");
    // Raw helper calls, no page-object rewrite applied.
    assert.equal(extractBusinessFunctions({ spec: RAW, pages, language: "ts" }), null);
  });
});

describe("extractBusinessFunction — JavaScript projects", () => {
  it("emits no type annotations", () => {
    const flow = lift(RAW, "log in with valid credentials", "js")!;

    assert.doesNotMatch(sourceOf(flow), /export interface/);
    assert.doesNotMatch(sourceOf(flow), /: Promise</);
    assert.match(sourceOf(flow), /export async function logInWithValidCredentials\(input = \{\}\)/);
  });
});

describe("flowName", () => {
  it("reads verbNoun off the plan's own title", () => {
    assert.equal(flowName("Verify the Free tag is shown"), "verifyTheFreeTagIsShown");
    assert.equal(flowName("log in with valid credentials"), "logInWithValidCredentials");
  });

  it("survives punctuation a human would write in a title", () => {
    assert.equal(flowName('Verify the "Free" tag is shown'), "verifyTheFreeTagIsShown");
  });

  it("never produces an identifier starting with a digit", () => {
    assert.match(flowName("2 items in the cart")!, /^[a-zA-Z_]/);
  });

  it("declines a title with nothing usable in it", () => {
    assert.equal(flowName("!!!"), null);
  });
});

/** A flow record as `.testlab/flows.json` would hold it. */
function record(overrides: Partial<FlowRecord> & { callSequence: string[] }): FlowRecord {
  return {
    name: "logIn",
    file: "logIn.ts",
    inputFields: [],
    outputFields: [],
    usedBy: [],
    createdAt: 0,
    ...overrides,
  };
}

const FULL_SEQUENCE = [
  "homePage.open",
  "homePage.enterEmailField",
  "homePage.enterPasswordField",
  "homePage.clickSignInButton",
  "homePage.getPageHeadingText",
];

function liftWith(existingFlows: FlowRecord[], spec = RAW, title = "log in with valid credentials") {
  const pages = partitionByPage(spec, "web", title);
  const rewrite = rewriteToPageObjects(spec, pages)!;
  const rewritten = finalizeImports(rewrite.code, rewrite.pagesUsed);
  return single(extractBusinessFunctions({ spec: rewritten, pages, language: "ts", existingFlows }));
}

describe("extractBusinessFunction — reuse", () => {
  // The centralized-repo case: someone else already automated this scenario,
  // so a second person's prompt calls theirs instead of adding a near-duplicate
  // beside it.
  it("calls an existing flow outright when the call sequence is identical", () => {
    const existing = record({
      name: "signIn",
      file: "signIn.ts",
      callSequence: FULL_SEQUENCE,
      inputFields: ["emailField", "passwordField"],
      outputFields: ["welcomeHeading"],
    });
    const flow = liftWith([existing])!;

    assert.equal(flow.reusedExisting, true);
    assert.equal(flow.source, null, "a duplicate flow module was written anyway");
    assert.equal(flow.name, "signIn");
    assert.match(flow.spec, /import \{ signIn \} from '\.\.\/\.\.\/src\/flows\/signIn\.js';/);
  });

  // The existing flow's own field names win: this spec called its local
  // `heading`, but what it is now reading is `signIn`'s `welcomeHeading`.
  it("rebinds the assertions onto the existing flow's field names", () => {
    const existing = record({
      name: "signIn",
      file: "signIn.ts",
      callSequence: FULL_SEQUENCE,
      inputFields: ["emailField", "passwordField"],
      outputFields: ["welcomeHeading"],
    });
    const flow = liftWith([existing])!;

    assert.match(flow.spec, /expect\(outcome\.welcomeHeading\)\.toBe\('Welcome back'\)/);
    assert.doesNotMatch(flow.spec, /outcome\.heading\b/);
  });

  it("drops an argument the existing flow's signature does not declare", () => {
    const existing = record({
      name: "signIn",
      file: "signIn.ts",
      callSequence: FULL_SEQUENCE,
      // Hand-edited since: it no longer takes a password.
      inputFields: ["emailField"],
      outputFields: ["heading"],
    });
    const flow = liftWith([existing])!;

    assert.match(flow.spec, /emailField:/);
    assert.doesNotMatch(flow.spec, /passwordField:/, "passed an argument the flow no longer accepts");
  });

  // "Log in" is the canonical precondition: a later scenario that starts the
  // same way delegates rather than repeating the steps, so the login screen
  // has exactly one definition.
  it("delegates its opening steps to an existing flow that already performs them", () => {
    const login = record({
      name: "logIn",
      file: "logIn.ts",
      callSequence: FULL_SEQUENCE.slice(0, 4),
      inputFields: ["emailField", "passwordField"],
      outputFields: [],
    });
    const flow = liftWith([login])!;

    assert.deepEqual(flow.composedFrom, { name: "logIn", steps: 4 });
    assert.match(sourceOf(flow), /import \{ logIn \} from '\.\/logIn\.js';/);
    assert.match(sourceOf(flow), /await logIn\(\{ emailField: input\.emailField, passwordField: input\.passwordField \}\);/);
    // The delegated steps are gone from the body, the rest remain.
    assert.doesNotMatch(sourceOf(flow), /homePage\.clickSignInButton/);
    assert.match(sourceOf(flow), /const heading = await homePage\.getPageHeadingText\(\);/);
  });

  it("ignores a flow whose sequence is unrelated", () => {
    const unrelated = record({ name: "checkOut", file: "checkOut.ts", callSequence: ["cartPage.open", "cartPage.clickPay"] });
    const flow = liftWith([unrelated])!;

    assert.equal(flow.reusedExisting, undefined);
    assert.equal(flow.composedFrom, undefined);
    assert.ok(flow.source, "should have written its own flow");
  });

  // Wrapping a single call in a named function reads worse than the call.
  it("does not delegate a prefix too short to be worth naming", () => {
    const tiny = record({ name: "openHome", file: "openHome.ts", callSequence: ["homePage.open"] });
    const flow = liftWith([tiny])!;

    assert.equal(flow.composedFrom, undefined);
    assert.match(sourceOf(flow), /await homePage\.open\(\);/);
  });

  it("prefers the longest matching prefix when several flows could serve", () => {
    const short = record({ name: "openAndType", file: "openAndType.ts", callSequence: FULL_SEQUENCE.slice(0, 2) });
    const long = record({ name: "logIn", file: "logIn.ts", callSequence: FULL_SEQUENCE.slice(0, 4) });
    const flow = liftWith([short, long])!;

    assert.equal(flow.composedFrom?.name, "logIn");
  });
});
