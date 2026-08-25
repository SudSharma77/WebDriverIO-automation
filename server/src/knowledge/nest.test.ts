import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nestScenario } from "./nest.js";

const EXISTING = `/**
 * Test: login with credentials
 * Target: web at https://www.iwanttfc.com/
 * Preconditions:
 * - None
 * Steps:
 * 1. Click the "Confirm" button to dismiss the cookie banner
 * Expected Result:
 * - UNVERIFIED: exploration ended before the outcome was observed
 */
import { click, type, getText, isVisible, waitForGone, waitForPageLoad, dismissIfPresent } from '@testlab/framework';

describe('login with credentials', () => {
  it('should login with credentials', async () => {
    await browser.url('https://www.iwanttfc.com/');
    await waitForPageLoad();
    await click('button*=Confirm', { label: 'Confirm cookie banner' });
    const searchInput = $('input[placeholder*="Search by title"]');
    await expect(searchInput).toExist();
  });
});
`;

const ADDITION = `/**
 * Test: Login with valid credentials then logout
 * Target: web app at https://www.iwanttfc.com/
 * Preconditions:
 * - None
 * Steps:
 * 1. Click the profile icon to open the account menu
 * 2. Click "Sign Out"
 * Expected Result:
 * - The login form is shown again
 */
import { click, type, getText, isVisible, waitForGone, waitForPageLoad, dismissIfPresent } from '@testlab/framework';

describe('Login with valid credentials then logout', () => {
  it('Login with valid credentials then logout', async () => {
    await click('[aria-label="Account"]', { label: 'Account icon' });
    await click('button=Sign Out', { label: 'Sign Out' });
    const loginButton = $('button*=Continue');
    await expect(loginButton).toBeDisplayed();
  });
});
`;

describe("nestScenario", () => {
  it("splices the new it() in as a sibling, right before the describe's closing brace", () => {
    const merged = nestScenario(EXISTING, ADDITION);
    assert.ok(merged, "expected a spliced result, got null");

    // Both scenarios survive, each with their own it().
    assert.match(merged!, /it\('should login with credentials'/);
    assert.match(merged!, /it\('Login with valid credentials then logout'/);

    // Still exactly one describe and one closing `});` at the end - a second
    // top-level describe would mean this appended a new file, not a sibling.
    assert.equal((merged!.match(/\bdescribe\(/g) ?? []).length, 1);
  });

  it("keeps the result valid JS - balanced braces, both it() bodies intact", () => {
    const merged = nestScenario(EXISTING, ADDITION)!;
    const opens = (merged.match(/\{/g) ?? []).length;
    const closes = (merged.match(/\}/g) ?? []).length;
    assert.equal(opens, closes);
    assert.match(merged, /await expect\(searchInput\)\.toExist\(\);/);
    assert.match(merged, /await expect\(loginButton\)\.toBeDisplayed\(\);/);
  });

  it("unions the framework imports rather than keeping only the first file's", () => {
    const additionWithNewHelper = ADDITION.replace(
      "import { click, type, getText, isVisible, waitForGone, waitForPageLoad, dismissIfPresent } from '@testlab/framework';",
      "import { click, selectOption } from '@testlab/framework';",
    );
    const merged = nestScenario(EXISTING, additionWithNewHelper)!;
    const importLine = /import \{([^}]*)\} from '@testlab\/framework';/.exec(merged)?.[1] ?? "";
    const names = importLine.split(",").map((n) => n.trim());

    assert.ok(names.includes("selectOption"), "new helper should be pulled in");
    assert.ok(names.includes("waitForPageLoad"), "existing helpers should not be dropped");
    // No duplicate: 'click' is in both files but must appear once.
    assert.equal(names.filter((n) => n === "click").length, 1);
  });

  it("returns null rather than guessing when the existing file has no describe", () => {
    assert.equal(nestScenario("const x = 1;\n", ADDITION), null);
  });

  it("returns null rather than guessing when the addition has no it()", () => {
    assert.equal(nestScenario(EXISTING, "describe('x', () => {});\n"), null);
  });

  it("does not corrupt the existing file when it declines to splice", () => {
    // The caller's contract: on null, the existing file is untouched by this
    // call - it never partially rewrites before discovering a mismatch.
    const before = EXISTING;
    nestScenario(EXISTING, "not a spec at all");
    assert.equal(EXISTING, before);
  });
});
