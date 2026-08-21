import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderPage, renderSelectors } from "./codegen.js";
import { partitionByPage, slugFromUrl, slugify, toClassName, toProperty } from "./structure.js";

const SPEC = `import { click, type, getText, isVisible } from '@testlab/framework';

describe('Checkout', () => {
  it('buys a laptop', async () => {
    await browser.url('https://shop.example.com/login');
    await type('#username', process.env.TESTLAB_SECRET_USERNAME, { label: 'the username field' });
    await type('#password', process.env.TESTLAB_SECRET_PASSWORD, { label: 'the password field' });
    await click('button[type=submit]', { label: 'the sign in button' });

    await browser.url('https://shop.example.com/cart');
    await click('[data-testid=checkout]', { label: 'the checkout button' });
    const total = await getText('.order-total', { label: 'the order total' });
    await expect(total).toContain('1299');
  });
});
`;

describe("partitionByPage", () => {
  const pages = partitionByPage(SPEC, "web", "Checkout");

  it("splits elements across pages at each navigation", () => {
    assert.deepEqual(
      pages.map((p) => p.className),
      ["LoginPage", "CartPage"],
    );
  });

  it("attributes each element to the page that was open", () => {
    assert.deepEqual(
      pages[0]!.elements.map((e) => e.property),
      ["usernameField", "passwordField", "signInButton"],
    );
    assert.deepEqual(
      pages[1]!.elements.map((e) => e.property),
      ["checkoutButton", "orderTotal"],
    );
  });

  it("records the interaction so the right method is generated", () => {
    assert.deepEqual(pages[0]!.elements[0]!.interactions, ["type"]);
    assert.deepEqual(pages[1]!.elements[1]!.interactions, ["read"]);
  });

  it("keeps the URL each page was observed at", () => {
    assert.equal(pages[0]!.url, "https://shop.example.com/login");
  });

  it("falls back to the scenario name when there is no navigation, as on mobile", () => {
    const mobile = partitionByPage(
      "await click('~login-btn', { label: 'the login button' });",
      "android",
      "Sign in flow",
    );
    assert.equal(mobile.length, 1);
    assert.equal(mobile[0]!.className, "SignInFlowPage");
    assert.equal(mobile[0]!.url, undefined);
  });

  it("merges repeat interactions on one element rather than duplicating it", () => {
    const source = `await click('#x', { label: 'the thing' });
await getText('#x', { label: 'the thing' });`;
    const [page] = partitionByPage(source, "web", "S");
    assert.equal(page!.elements.length, 1);
    assert.deepEqual(page!.elements[0]!.interactions, ["click", "read"]);
  });
});

describe("naming", () => {
  it("drops leading articles when building a property name", () => {
    assert.equal(toProperty("the username field"), "usernameField");
    assert.equal(toProperty("a confirmation banner"), "confirmationBanner");
  });

  it("produces a valid identifier when the label starts with a digit", () => {
    assert.equal(toProperty("2fa code box"), "element2faCodeBox");
  });

  it("names a page from the URL path, not the domain", () => {
    assert.equal(slugFromUrl("https://shop.example.com/checkout/payment"), "checkout-payment");
    assert.equal(slugFromUrl("https://shop.example.com/"), "home");
  });

  it("ignores id segments that would make a per-record page class", () => {
    assert.equal(slugFromUrl("https://shop.example.com/orders/48213"), "orders");
  });

  it("builds a class name from a slug", () => {
    assert.equal(toClassName("checkout-payment"), "CheckoutPaymentPage");
  });

  it("leaves no dangling separator when a long title is truncated", () => {
    // Truncation can land exactly on a word boundary; trimming has to happen
    // after the cut or the filename ends in a hyphen.
    assert.equal(slugify("Left navigation on terms and conditions page"), "left-navigation-on-terms-and-conditions");
  });
});

describe("codegen", () => {
  const [login] = partitionByPage(SPEC, "web", "Checkout");

  it("emits selectors as plain data", () => {
    const source = renderSelectors(login!);
    assert.match(source, /export const LoginSelectors = \{/);
    assert.match(source, /usernameField: "#username"/);
    assert.match(source, /\/\*\* the username field \*\//);
  });

  it("emits a page class that imports its selectors and extends BasePage", () => {
    const source = renderPage(login!);
    assert.match(source, /import \{ BasePage \} from '\.\/BasePage\.js'/);
    assert.match(source, /import \{ LoginSelectors \} from '\.\.\/selectors\/login\.selectors\.js'/);
    assert.match(source, /export class LoginPage extends BasePage/);
  });

  it("names methods after the interaction, not the helper", () => {
    const source = renderPage(login!);
    assert.match(source, /async enterUsernameField\(value\)/);
    assert.match(source, /async clickSignInButton\(\)/);
  });

  it("gives a page with a URL an open\\(\\) method", () => {
    assert.match(renderPage(login!), /async open\(\) \{[\s\S]*browser\.url\("https:\/\/shop\.example\.com\/login"\)/);
  });

  it("exports a ready-made instance so specs need no constructor noise", () => {
    assert.match(renderPage(login!), /export const loginPage = new LoginPage\(\);/);
  });
});
