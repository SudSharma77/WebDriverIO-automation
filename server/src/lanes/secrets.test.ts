import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SECRET_ENV_PREFIX,
  SecretBag,
  bindSecretsInSpec,
  placeholdersIn,
  unbindSecretsInSpec,
} from "./secrets.js";

/**
 * These cover the credential path, where a subtle bug does not throw — it
 * quietly puts a password somewhere it should never be, or types the wrong
 * thing into a login form and reports a confusing test failure instead.
 */

const bag = () => SecretBag.from({ USERNAME: "alice", PASSWORD: "alice-hunter2!" });

describe("SecretBag.fill", () => {
  it("substitutes placeholders through nested tool arguments", () => {
    const filled = bag().fill({ selector: "#pw", value: "{{PASSWORD}}", opts: { list: ["{{USERNAME}}"] } });
    assert.deepEqual(filled, { selector: "#pw", value: "alice-hunter2!", opts: { list: ["alice"] } });
  });

  it("leaves an unknown placeholder intact so the failure is visible", () => {
    // Substituting "" here would submit an empty password and produce a
    // validation error that looks nothing like the actual typo.
    assert.equal(bag().fill("{{PASSWROD}}"), "{{PASSWROD}}");
  });

  it("passes non-string values through untouched", () => {
    assert.deepEqual(bag().fill({ timeout: 5000, enabled: true, missing: null }), {
      timeout: 5000,
      enabled: true,
      missing: null,
    });
  });
});

describe("SecretBag.redact", () => {
  it("replaces the longest secret first so a shorter one cannot fragment it", () => {
    // "alice" is a substring of "alice-hunter2!"; shortest-first would leave
    // "-hunter2!" sitting in the transcript.
    assert.equal(bag().redact("typed alice-hunter2! in"), "typed {{PASSWORD}} in");
  });

  it("replaces every occurrence", () => {
    assert.equal(bag().redact("alice / alice"), "{{USERNAME}} / {{USERNAME}}");
  });
});

describe("bindSecretsInSpec", () => {
  it("consumes the quotes so the result is an env read, not a string containing one", () => {
    assert.equal(
      bindSecretsInSpec("await $('#pw').setValue('{{PASSWORD}}');"),
      `await $('#pw').setValue(process.env.${SECRET_ENV_PREFIX}PASSWORD);`,
    );
  });

  it("handles double quotes and backticks", () => {
    const expected = `setValue(process.env.${SECRET_ENV_PREFIX}PASSWORD)`;
    assert.equal(bindSecretsInSpec('setValue("{{PASSWORD}}")'), expected);
    assert.equal(bindSecretsInSpec("setValue(`{{PASSWORD}}`)"), expected);
  });

  it("promotes an embedded placeholder to a template literal that interpolates", () => {
    assert.equal(
      bindSecretsInSpec("expect(h).toHaveText('Welcome, {{USERNAME}}!')"),
      `expect(h).toHaveText(\`Welcome, \${process.env.${SECRET_ENV_PREFIX}USERNAME}!\`)`,
    );
  });

  it("escapes template syntax already present in the literal", () => {
    const bound = bindSecretsInSpec("toHaveText('${notAVar} {{USERNAME}}')");
    assert.ok(bound.includes("\\${notAVar}"), `existing \${} was not escaped: ${bound}`);
  });

  it("leaves specs without placeholders byte-identical", () => {
    const spec = "await $('#login').click(); await expect($('h1')).toHaveText('Dashboard');";
    assert.equal(bindSecretsInSpec(spec), spec);
  });

  it("never leaves a literal secret in the spec", () => {
    assert.ok(!bindSecretsInSpec("setValue('{{PASSWORD}}')").includes("alice"));
  });
});

describe("unbindSecretsInSpec", () => {
  it("round-trips the standalone form back to valid JS", () => {
    const original = "setValue('{{PASSWORD}}'); setValue('{{USERNAME}}');";
    assert.equal(unbindSecretsInSpec(bindSecretsInSpec(original)), original);
  });

  it("round-trips the embedded form", () => {
    assert.equal(
      unbindSecretsInSpec(bindSecretsInSpec("toHaveText('Welcome, {{USERNAME}}!')")),
      "toHaveText(`Welcome, {{USERNAME}}!`)",
    );
  });
});

describe("validation and defaults", () => {
  it("rejects a malformed name rather than dropping it silently", () => {
    assert.throws(() => SecretBag.from({ "bad-name": "x" }), /not a valid secret name/);
  });

  it("skips empty values", () => {
    assert.deepEqual(SecretBag.from({ USERNAME: "" }).names, []);
  });

  it("treats an absent bag as a no-op everywhere", () => {
    const empty = SecretBag.from(undefined);
    assert.equal(empty.isEmpty, true);
    assert.equal(empty.briefing(), "");
    assert.equal(empty.redact("untouched"), "untouched");
    assert.deepEqual(empty.runnerEnv(), {});
  });

  it("briefs the model with names only", () => {
    const text = bag().briefing();
    assert.ok(text.includes("{{PASSWORD}}"));
    assert.ok(!text.includes("alice"));
  });

  it("reports which placeholders a spec depends on", () => {
    assert.deepEqual(placeholdersIn("a {{USERNAME}} b {{PASSWORD}} c {{USERNAME}}"), ["PASSWORD", "USERNAME"]);
  });
});
