import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as config from "./config/index.mjs";
import * as runtime from "./runtime/index.ts";

/**
 * The config layer is plain ESM with hand-written types beside it (see the
 * header of config/index.mjs for why it cannot be TypeScript). Hand-written
 * declarations drift: `TypeOptions` in the old runtime .d.ts silently lacked
 * `mask` for as long as masking had existed, which is exactly the failure this
 * guards against on the one module that still needs declarations.
 *
 * A .d.ts cannot be compared to an implementation at runtime, so this asserts
 * the half that is checkable and that actually broke: every name the types
 * promise is really exported, and is really the kind of thing they claim.
 */

const DECLARED_CONFIG_EXPORTS = ["DEFAULT_SPECS", "baseConfig", "webConfig", "androidConfig", "iosConfig"] as const;

describe("config/index.d.mts matches config/index.mjs", () => {
  it("exports every declared name", () => {
    for (const name of DECLARED_CONFIG_EXPORTS) {
      assert.ok(name in config, `config/index.d.ts declares "${name}" but index.mjs does not export it`);
    }
  });

  it("declares every exported name", () => {
    for (const name of Object.keys(config)) {
      assert.ok(
        (DECLARED_CONFIG_EXPORTS as readonly string[]).includes(name),
        `index.mjs exports "${name}" but config/index.d.ts does not declare it`,
      );
    }
  });

  it("builds a config for every platform without touching a browser session", () => {
    // The factories must be pure — the orchestrator calls them before any
    // session exists, and this test runs with no WebdriverIO globals at all.
    for (const factory of [config.webConfig, config.androidConfig, config.iosConfig]) {
      const built = factory();
      assert.equal(built.framework, "mocha");
      assert.ok(Array.isArray(built.capabilities));
      assert.ok(Array.isArray(built.specs));
    }
  });

  it("gives every platform the same spec glob, so they cannot disagree", () => {
    assert.deepEqual(config.webConfig().specs, config.DEFAULT_SPECS);
    assert.deepEqual(config.androidConfig().specs, config.DEFAULT_SPECS);
    assert.deepEqual(config.iosConfig().specs, config.DEFAULT_SPECS);
  });

  it("finds TypeScript specs — the whole point of the migration", () => {
    assert.ok(
      config.DEFAULT_SPECS.some((glob) => glob.endsWith(".ts")),
      "the default spec glob would not match a generated TypeScript spec",
    );
  });
});

describe("runtime exports", () => {
  // The spec-facing surface. A rename here silently breaks every generated
  // spec's import line and every page object, so it is worth pinning.
  const HELPERS = [
    "find",
    "click",
    "type",
    "selectOption",
    "getText",
    "isVisible",
    "waitForGone",
    "dismissIfPresent",
    "waitForPageLoad",
    "describeScreen",
    // Narration, imported by every generated business function.
    "step",
    "check",
  ] as const;

  it("exports every helper a generated spec is told to import", () => {
    for (const name of HELPERS) {
      assert.equal(typeof runtime[name], "function", `runtime no longer exports ${name}()`);
    }
  });

  it("exports ElementNotFoundError as a real Error subclass", () => {
    const error = new runtime.ElementNotFoundError("#missing", "the thing", []);
    assert.ok(error instanceof Error);
    assert.equal(error.selector, "#missing");
    assert.match(error.message, /Could not find the thing \(#missing\)/);
  });

  it("names what was on screen when a selector misses, so a repair pass has something to act on", () => {
    const error = new runtime.ElementNotFoundError("#missing", undefined, ["#login", "button[name=\"go\"]"]);
    assert.match(error.message, /#login/);
    assert.match(error.message, /button\[name="go"\]/);
  });

  // `check` wraps a value in place inside a business function's return object,
  // so it has to hand back exactly what it was given.
  it("returns the observation check() was handed, rather than only logging it", () => {
    assert.equal(runtime.check("the cart is empty", true), true);
    assert.equal(runtime.check("the cart is empty", false), false);
  });

  // Business functions report; specs assert. A check that threw would move the
  // assertion into the wrong layer and stop the flow before it could return
  // the rest of its observations.
  it("never throws on a failed check", () => {
    assert.doesNotThrow(() => runtime.check("something that did not happen", false));
  });
});
