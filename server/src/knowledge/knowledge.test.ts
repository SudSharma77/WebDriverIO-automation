import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractLocators, extractRequiredSecrets } from "./extract.js";
import { decideReuse, mergeLocators, opposed, similarity } from "./reuse.js";
import type { Catalog, SpecIndex } from "./types.js";

const SPEC = `import { click, type, getText, isVisible } from '@testlab/framework';

describe('Login', () => {
  it('signs in', async () => {
    await browser.url('https://shop.example.com/login');
    await type('#username', process.env.TESTLAB_SECRET_USERNAME, { label: 'the username field' });
    await type('#password', process.env.TESTLAB_SECRET_PASSWORD, { label: 'the password field' });
    await click('button[type=submit]', { label: 'the login button' });
    const banner = await getText('#flash', { label: 'the confirmation banner' });
    await expect(banner).toContain('Welcome');
  });
});
`;

describe("extractLocators", () => {
  it("pairs each selector with its label", () => {
    assert.deepEqual(extractLocators(SPEC), [
      { label: "the username field", selector: "#username" },
      { label: "the password field", selector: "#password" },
      { label: "the login button", selector: "button[type=submit]" },
      { label: "the confirmation banner", selector: "#flash" },
    ]);
  });

  it("skips calls with no label, having no stable name to file them under", () => {
    assert.deepEqual(extractLocators("await click('#anon');"), []);
  });

  it("does not mistake a method call on another object for a helper", () => {
    assert.deepEqual(extractLocators("await page.click('#x', { label: 'nope' });"), []);
    assert.deepEqual(extractLocators("await myClick('#x', { label: 'nope' });"), []);
  });

  it("survives nested calls that would break a non-greedy regex", () => {
    const source = "await click($('.row').selector, { label: 'the row' });";
    // The first string literal is not a selector here, so nothing is learned —
    // but the scan must not run past the call and corrupt later matches.
    const after = `${source}\nawait click('#next', { label: 'the next button' });`;
    assert.deepEqual(extractLocators(after), [{ label: "the next button", selector: "#next" }]);
  });

  it("keeps the first selector when a label is reused", () => {
    const source = "await click('#a', { label: 'thing' }); await click('#b', { label: 'thing' });";
    assert.deepEqual(extractLocators(source), [{ label: "thing", selector: "#a" }]);
  });

  it("lists the credentials a spec needs", () => {
    assert.deepEqual(extractRequiredSecrets(SPEC, "TESTLAB_SECRET_"), ["PASSWORD", "USERNAME"]);
  });
});

describe("similarity", () => {
  it("scores a reworded version of the same scenario as a match", () => {
    const score = similarity(
      "Log a user in with valid credentials and confirm the dashboard appears",
      "Log in with valid credentials, verify the dashboard is shown",
    );
    assert.ok(score >= 0.5, `expected a match, got ${score}`);
  });

  it("is 1 for identical prompts", () => {
    assert.equal(similarity("add item to cart", "add item to cart"), 1);
  });
});

describe("opposed", () => {
  it("catches the case word overlap cannot: opposite actions on the same object", () => {
    // These score 0.5 on overlap — high enough to replay, and replaying the
    // wrong one would report an untested scenario as passing.
    assert.ok(similarity("add a laptop to the cart", "remove a laptop from the cart") >= 0.5);
    assert.ok(opposed("add a laptop to the cart", "remove a laptop from the cart"));
  });

  it("catches login versus logout", () => {
    assert.ok(opposed("verify login works", "verify logout works"));
  });

  it("catches a valid/invalid credentials pair", () => {
    assert.ok(opposed("sign in with valid credentials", "sign in with invalid credentials"));
  });

  it("does not fire when both prompts mention both sides", () => {
    assert.ok(!opposed("add then remove an item", "add then remove an item from the cart"));
  });

  it("does not fire on unrelated prompts", () => {
    assert.ok(!opposed("search for a product", "open the profile page"));
  });
});

const emptyCatalog = (): Catalog => ({ version: 1, clientId: "acme", entries: [] });
const emptySpecs = (): SpecIndex => ({ version: 1, clientId: "acme", specs: [] });

describe("decideReuse", () => {
  const base = { platform: "web" as const, target: "https://shop.example.com" };

  it("explores when nothing is known", () => {
    const decision = decideReuse({ ...base, prompt: "add a laptop to the cart", specs: emptySpecs(), catalog: emptyCatalog() });
    assert.equal(decision.mode, "explored");
  });

  it("replays a matching spec without any model call", () => {
    const specs = emptySpecs();
    specs.specs.push({
      file: "login.web.spec.js",
      prompt: "Log in with valid credentials and confirm the dashboard",
      title: "Login",
      platform: "web",
      target: base.target,
      createdAt: 1,
      lastVerified: 1,
      passCount: 3,
      requiresSecrets: ["PASSWORD", "USERNAME"],
    });

    const decision = decideReuse({ ...base, prompt: "Log in using valid credentials, verify dashboard", specs, catalog: emptyCatalog() });
    assert.equal(decision.mode, "replayed");
    assert.equal(decision.spec?.file, "login.web.spec.js");
  });

  it("refuses to replay the opposite scenario even when wording overlaps", () => {
    const specs = emptySpecs();
    specs.specs.push({
      file: "add-to-cart.web.spec.js",
      prompt: "add a laptop to the cart",
      title: "Add to cart",
      platform: "web",
      target: base.target,
      createdAt: 1,
      lastVerified: 1,
      passCount: 5,
      requiresSecrets: [],
    });

    const decision = decideReuse({ ...base, prompt: "remove a laptop from the cart", specs, catalog: emptyCatalog() });
    assert.notEqual(decision.mode, "replayed");
  });

  it("will not replay a spec verified against a different app", () => {
    const specs = emptySpecs();
    specs.specs.push({
      file: "login.web.spec.js",
      prompt: "Log in with valid credentials and confirm the dashboard",
      title: "Login",
      platform: "web",
      target: "https://other.example.com",
      createdAt: 1,
      lastVerified: 1,
      passCount: 1,
      requiresSecrets: [],
    });

    const decision = decideReuse({ ...base, prompt: "Log in with valid credentials and confirm the dashboard", specs, catalog: emptyCatalog() });
    assert.notEqual(decision.mode, "replayed");
  });

  it("writes from the catalog when elements are known but no spec matches", () => {
    const catalog = emptyCatalog();
    catalog.entries.push({
      label: "the login button",
      selector: "#login",
      platform: "web",
      firstSeen: 1,
      lastVerified: 1,
      usedBy: ["login.web.spec.js"],
      history: [],
    });

    const decision = decideReuse({ ...base, prompt: "delete an address from the profile page", specs: emptySpecs(), catalog });
    assert.equal(decision.mode, "from-catalog");
    assert.equal(decision.known.length, 1);
  });
});

describe("mergeLocators", () => {
  const context = { platform: "web" as const, specFile: "login.web.spec.js", now: 100 };

  it("adds unknown locators", () => {
    const result = mergeLocators(emptyCatalog(), [{ label: "the login button", selector: "#login" }], context);
    assert.deepEqual(result.added, ["the login button"]);
    assert.equal(result.catalog.entries[0]?.selector, "#login");
  });

  it("retires the old selector when a build moves an element", () => {
    const first = mergeLocators(emptyCatalog(), [{ label: "the login button", selector: "#login" }], context);
    const second = mergeLocators(first.catalog, [{ label: "the login button", selector: "#signin" }], { ...context, now: 200 });

    assert.deepEqual(second.changed, ["the login button"]);
    const entry = second.catalog.entries[0]!;
    assert.equal(entry.selector, "#signin");
    assert.deepEqual(entry.history, [{ selector: "#login", retiredAt: 200 }]);
    // firstSeen is the point of the record; only lastVerified moves.
    assert.equal(entry.firstSeen, 100);
    assert.equal(entry.lastVerified, 200);
  });

  it("does not duplicate a spec in usedBy across repeat runs", () => {
    const first = mergeLocators(emptyCatalog(), [{ label: "b", selector: "#b" }], context);
    const second = mergeLocators(first.catalog, [{ label: "b", selector: "#b" }], { ...context, now: 300 });
    assert.deepEqual(second.catalog.entries[0]?.usedBy, ["login.web.spec.js"]);
    assert.deepEqual(second.changed, []);
  });

  it("keeps the same label on different platforms apart", () => {
    const web = mergeLocators(emptyCatalog(), [{ label: "the login button", selector: "#login" }], context);
    const android = mergeLocators(web.catalog, [{ label: "the login button", selector: "~login-btn" }], {
      ...context,
      platform: "android",
      specFile: "login.android.spec.js",
    });
    assert.equal(android.catalog.entries.length, 2);
    assert.deepEqual(android.changed, []);
  });
});
