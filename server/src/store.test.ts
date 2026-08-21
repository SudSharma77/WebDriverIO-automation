import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { RunStore } from "./store.js";
import type { LaneStatus, RunTarget } from "./types.js";

/**
 * The cache decides whether a run costs a browser session or nothing, so the
 * rule it enforces — only replay something that actually worked — is worth
 * pinning down. Serving a failed spec is worse than having no cache: it burns
 * a session re-proving a known failure, and the path calls no model, so a
 * better prompt can never rescue it.
 */

const TARGET: RunTarget = { webUrl: "https://shop.example.com" };

/**
 * A fresh, non-persistent store per test.
 *
 * Using the exported singleton here wrote run.json files into the real
 * artifact directory, and every fixture prompt turned up in the user's run
 * history. Tests get their own instance with persistence off.
 */
let store: RunStore;
beforeEach(() => {
  store = new RunStore({ persistent: false });
});

function seed(prompt: string, status: LaneStatus, specCode: string) {
  const run = store.create({ prompt, platforms: ["web"], target: TARGET, clientId: "test" });
  store.emit(run.id, { type: "artifact", platform: "web", kind: "spec", code: specCode });
  store.emit(run.id, { type: "lane.status", platform: "web", status });
  return run;
}

describe("findCachedSpec", () => {
  it("does not serve a spec from a failed run", () => {
    const prompt = "cache test: a scenario that failed to verify";
    seed(prompt, "failed", "// broken spec");
    assert.equal(store.findCachedSpec(prompt, "web", TARGET), null);
  });

  it("serves a spec from a passing run", () => {
    const prompt = "cache test: a scenario that passed cleanly";
    seed(prompt, "passed", "// good spec");
    assert.equal(store.findCachedSpec(prompt, "web", TARGET), "// good spec");
  });

  it("prefers the newest passing run when a prompt has been run repeatedly", () => {
    const prompt = "cache test: a scenario run more than once";
    seed(prompt, "passed", "// first");
    seed(prompt, "passed", "// second");
    assert.equal(store.findCachedSpec(prompt, "web", TARGET), "// second");
  });

  it("ignores a later failure and keeps serving the earlier green spec", () => {
    const prompt = "cache test: passed once then failed later";
    seed(prompt, "passed", "// the good one");
    seed(prompt, "failed", "// the regression");
    assert.equal(store.findCachedSpec(prompt, "web", TARGET), "// the good one");
  });

  it("does not cross targets — the same words about a different app are a different test", () => {
    const prompt = "cache test: same wording, different app";
    seed(prompt, "passed", "// for shop");
    assert.equal(store.findCachedSpec(prompt, "web", { webUrl: "https://other.example.com" }), null);
  });

  it("does not serve a spec from an errored or skipped lane", () => {
    for (const status of ["error", "skipped"] as const) {
      const prompt = `cache test: lane ended as ${status}`;
      seed(prompt, status, "// incomplete");
      assert.equal(store.findCachedSpec(prompt, "web", TARGET), null);
    }
  });
});

describe("clearHistory", () => {
  it("forgets finished runs", () => {
    const prompt = "clear test: a finished run that should be forgotten";
    const run = seed(prompt, "passed", "// spec");
    store.emit(run.id, { type: "run.done", runId: run.id });

    store.clearHistory();
    assert.equal(store.get(run.id), undefined);
  });

  it("keeps a run that is still in flight", () => {
    // Its lanes hold live browser sessions and are still emitting into it.
    const run = store.create({ prompt: "clear test: still running", platforms: ["web"], target: TARGET });
    store.emit(run.id, { type: "lane.status", platform: "web", status: "running" });

    const { kept } = store.clearHistory();
    assert.equal(kept, 1);
    assert.ok(store.get(run.id), "an in-flight run must survive a clear");
  });

  it("clears a run whose lanes settled but which never emitted run.done", () => {
    // The orphan case: the process died, or something threw past the
    // orchestrator's finally. Keying "in flight" off finishedAt alone made
    // these permanently unclearable rows in the history.
    const run = seed("clear test: settled but never marked done", "passed", "// spec");
    assert.equal(run.finishedAt, undefined);

    const { cleared } = store.clearHistory();
    assert.equal(cleared, 1);
    assert.equal(store.get(run.id), undefined);
  });

  it("drops the cached spec along with the run that produced it", () => {
    const prompt = "clear test: cache must not outlive its run";
    const run = seed(prompt, "passed", "// spec");
    store.emit(run.id, { type: "run.done", runId: run.id });
    assert.equal(store.findCachedSpec(prompt, "web", TARGET), "// spec");

    store.clearHistory();
    assert.equal(store.findCachedSpec(prompt, "web", TARGET), null);
  });

  it("forgets credentials with the run", () => {
    const run = store.create({
      prompt: "clear test: a run that carried credentials",
      platforms: ["web"],
      target: TARGET,
      secrets: { PASSWORD: "hunter2" },
    });
    store.emit(run.id, { type: "run.done", runId: run.id });
    assert.deepEqual(store.secrets(run.id).names, ["PASSWORD"]);

    store.clearHistory();
    assert.deepEqual(store.secrets(run.id).names, []);
  });

  it("refuses to forget a single run whose lane is still working", () => {
    const run = store.create({ prompt: "clear test: single, still running", platforms: ["web"], target: TARGET });
    store.emit(run.id, { type: "lane.status", platform: "web", status: "running" });
    assert.equal(store.forget(run.id), false);
    assert.ok(store.get(run.id));
  });

  it("forgets a single finished run", () => {
    const run = seed("clear test: single, finished", "passed", "// spec");
    store.emit(run.id, { type: "run.done", runId: run.id });
    assert.equal(store.forget(run.id), true);
    assert.equal(store.get(run.id), undefined);
  });
});
