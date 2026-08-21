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

  try {
    await element.waitForClickable({ timeout });
    await element.click();
  } catch (err) {
    // Nearly always an overlay — a cookie banner, a consent dialog, a modal —
    // that loaded after the page did and now sits on top of the target. The
    // native error says the element "still not clickable" or that another
    // element would receive the click, without saying which, so the repair
    // pass has nothing to act on. Name the thing in the way.
    const blocker = await describeBlocker(element);
    if (blocker) {
      throw new Error(
        `Could not click ${label ?? selector}: it is covered by ${blocker}.\n\n` +
          "Dismiss that element first — it is most likely a cookie or consent banner that appeared after the page " +
          "loaded. Add a step that closes it before this one, and wait for it to disappear rather than assuming it " +
          "is gone.",
      );
    }
    throw err;
  }
}

/**
 * What is actually on top of this element, if anything.
 *
 * Hit-tests the element's own centre point: if the topmost element there is
 * neither the target nor inside it, that is what a real click would land on.
 * Best-effort — this only runs on a path that is already failing, so it must
 * never throw and never mask the original error.
 */
async function describeBlocker(element) {
  try {
    const found = await browser.execute((el) => {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return null;

      const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      if (!top || top === el || el.contains(top) || top.contains(el)) return null;

      // Walk up to whichever ancestor established the stacking context — the
      // overlay container is far more identifiable than the <p> under the cursor.
      let node = top;
      for (let i = 0; i < 6 && node.parentElement; i++) {
        const position = getComputedStyle(node).position;
        if (position === "fixed" || position === "sticky") break;
        node = node.parentElement;
      }

      return {
        tag: node.tagName.toLowerCase(),
        id: node.id || null,
        testId: node.getAttribute("data-testid"),
        className: typeof node.className === "string" ? node.className.trim().split(/\s+/)[0] : null,
        text: (node.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80),
      };
    }, element);

    if (!found) return null;

    const identity =
      (found.testId && `[data-testid="${found.testId}"]`) ||
      (found.id && `#${found.id}`) ||
      (found.className && `${found.tag}.${found.className}`) ||
      `<${found.tag}>`;

    return found.text ? `${identity} — "${found.text}"` : identity;
  } catch {
    return null;
  }
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

  // Checked before touching the page, because WebdriverIO's own message for
  // this ("setValue/addValue only take string or number values") describes the
  // symptom and not the cause. The overwhelmingly common cause is a credential
  // that was never supplied to this run, and the value being absent is exactly
  // the case where naming it costs nothing — there is nothing to leak.
  if (typeof text !== "string" && typeof text !== "number") {
    const what = text === undefined ? "undefined" : text === null ? "null" : typeof text;
    throw new Error(
      `Cannot type into ${label ?? selector}: the value is ${what}.\n\n` +
        "If this value comes from process.env.TESTLAB_SECRET_*, that credential was not supplied to this run. " +
        "Credentials are held only for the lifetime of the run that received them, so a later replay — a regression " +
        "check, or a reused spec — has to be given them again.",
    );
  }

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

/**
 * Dismiss a banner or dialog if it turns up, and do nothing if it does not.
 *
 * Consent banners are the reason this exists. They load asynchronously, so a
 * spec that clicks the accept button immediately after navigating often runs
 * before the banner exists — and then it appears a second later and covers the
 * form. Clicking it unconditionally is equally wrong, because on a return visit
 * the cookie is already set and the banner never shows, so the step fails.
 *
 * Waits for it, dismisses it, then waits for it to actually go away. Returns
 * whether there was anything to dismiss.
 */
export async function dismissIfPresent(selector, options = {}) {
  const { timeout = 5000, label } = options;

  if (!(await isVisible(selector, { timeout }))) return false;

  const element = await $(selector);
  await element.click();

  // A banner that animates out still intercepts clicks while it fades.
  try {
    await element.waitForDisplayed({ timeout, reverse: true });
  } catch {
    throw new Error(
      `Clicked ${label ?? selector} but it is still on screen after ${timeout}ms. ` +
        "Whatever it covers cannot be interacted with while it remains.",
    );
  }
  return true;
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
