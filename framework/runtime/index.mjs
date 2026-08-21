/**
 * The runtime that generated specs are written against.
 *
 * Three things justify a helper layer here rather than bare `$()` calls, and
 * they are the same three that make an AI-written spec survive contact with a
 * real app:
 *
 *   1. Waiting is not optional and not the author's job to remember.
 *   2. A failure has to explain itself. When a selector misses, the spec is
 *      about to be handed to a repair pass; "element not found" gives it
 *      nothing to work with, while a list of what IS on screen usually gives it
 *      the right answer on the first try.
 *   3. Credentials must never reach an error message.
 *
 * Everything takes a selector string rather than owning one, so nothing here
 * assumes anything about the app under test.
 */

const DEFAULT_TIMEOUT = 15_000;

/** Interactive things worth listing when a selector misses. Web only. */
const CANDIDATE_QUERY = "button, a[href], input, select, textarea, [role=button], [data-testid], [aria-label]";

export class ElementNotFoundError extends Error {
  constructor(selector, label, nearby) {
    const what = label ? `${label} (${selector})` : selector;
    const suggestions = nearby.length
      ? `\n\nInteractive elements actually present:\n${nearby.map((n) => `  ${n}`).join("\n")}`
      : "\n\nNo interactive elements were found on the page at all — it may not have finished loading.";
    super(`Could not find ${what} within the timeout.${suggestions}`);
    this.name = "ElementNotFoundError";
    this.selector = selector;
  }
}

/**
 * Wait for a selector and return the element.
 *
 * On failure it pauses to describe the page before throwing, because that
 * description is what makes the difference between a repair pass that guesses
 * and one that corrects.
 */
export async function find(selector, options = {}) {
  const { timeout = DEFAULT_TIMEOUT, label } = options;
  const element = await $(selector);
  try {
    await element.waitForExist({ timeout });
    return element;
  } catch {
    throw new ElementNotFoundError(selector, label, await describeScreen());
  }
}

/**
 * List the interactive elements on screen, as selectors that would match them.
 *
 * Best-effort by design: this only ever runs on a path that is already failing,
 * so it must not throw and must not mask the original error.
 */
export async function describeScreen(limit = 25) {
  try {
    const elements = await $$(CANDIDATE_QUERY);
    const described = [];
    for (const element of elements.slice(0, limit)) {
      const line = await describeElement(element);
      if (line) described.push(line);
    }
    return described;
  } catch {
    return [];
  }
}

async function describeElement(element) {
  try {
    if (!(await element.isDisplayed())) return null;

    const [tag, testId, id, name, ariaLabel, text] = await Promise.all([
      element.getTagName().catch(() => ""),
      element.getAttribute("data-testid").catch(() => null),
      element.getAttribute("id").catch(() => null),
      element.getAttribute("name").catch(() => null),
      element.getAttribute("aria-label").catch(() => null),
      element.getText().catch(() => ""),
    ]);

    // Ordered by how stable each locator tends to be over time — the same
    // order the explorer is told to prefer, so its output and this advice agree.
    if (testId) return `[data-testid="${testId}"]`;
    if (id) return `#${id}`;
    if (name) return `${tag}[name="${name}"]`;
    if (ariaLabel) return `${tag}[aria-label="${ariaLabel}"]`;

    const label = text.trim().split("\n")[0]?.slice(0, 40);
    return label ? `${tag} with text "${label}"` : null;
  } catch {
    return null;
  }
}

/**
 * Click, once.
 *
 * Deliberately no retry loop: a click is not idempotent, and retrying "Place
 * Order" because the first attempt looked slow is how a test suite creates two
 * orders. Waiting for clickable is the correct fix for the flakiness a retry
 * would have papered over.
 */
export async function click(selector, options = {}) {
  const { timeout = DEFAULT_TIMEOUT, label } = options;
  const element = await find(selector, { timeout, label });
  await element.waitForClickable({ timeout });
  await element.click();
}

/**
 * Type into a field.
 *
 * The value never appears in an error message. This is the method that receives
 * passwords, and the moment a failure prints "expected 'hunter2', got ''" the
 * credential is in the run log, the SSE stream and the repair prompt.
 */
export async function type(selector, text, options = {}) {
  const { timeout = DEFAULT_TIMEOUT, label, clear = true } = options;
  const element = await find(selector, { timeout, label });
  await element.waitForDisplayed({ timeout });
  if (clear) await element.clearValue();
  await element.setValue(text);
}

export async function selectOption(selector, optionText, options = {}) {
  const { timeout = DEFAULT_TIMEOUT, label } = options;
  const element = await find(selector, { timeout, label });
  await element.waitForDisplayed({ timeout });
  await element.selectByVisibleText(optionText);
}

export async function getText(selector, options = {}) {
  const element = await find(selector, options);
  await element.waitForDisplayed({ timeout: options.timeout ?? DEFAULT_TIMEOUT });
  return (await element.getText()).trim();
}

export async function isVisible(selector, options = {}) {
  const { timeout = 3000 } = options;
  try {
    const element = await $(selector);
    await element.waitForDisplayed({ timeout });
    return true;
  } catch {
    return false;
  }
}

/** Wait for something to disappear — a spinner, a modal, a toast. */
export async function waitForGone(selector, options = {}) {
  const { timeout = DEFAULT_TIMEOUT } = options;
  const element = await $(selector);
  await element.waitForDisplayed({ timeout, reverse: true });
}

/**
 * Wait for the page to settle after a navigation or submit.
 *
 * document.readyState only, with no fixed pause: a sleep long enough to be
 * reliable is always long enough to waste minutes across a suite.
 */
export async function waitForPageLoad(options = {}) {
  const { timeout = DEFAULT_TIMEOUT } = options;
  await browser.waitUntil(async () => (await browser.execute(() => document.readyState)) === "complete", {
    timeout,
    timeoutMsg: "The page did not reach readyState=complete within the timeout.",
  });
}
