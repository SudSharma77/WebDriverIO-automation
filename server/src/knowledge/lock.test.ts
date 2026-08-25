import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isLocked, withClientLock } from "./lock.js";

/** A read-modify-write with a real await in the middle — the shape that loses data. */
function makeStore(initial: string[] = []) {
  const state = { entries: initial };
  return {
    state,
    async append(value: string): Promise<void> {
      const snapshot = [...state.entries];
      await new Promise((resolve) => setTimeout(resolve, 5));
      state.entries = [...snapshot, value];
    },
  };
}

describe("withClientLock", () => {
  // The bug this exists for: orchestrator.ts runs three platform lanes in
  // parallel and all three call recordSuccess against one project. Without
  // serialization the later write is built on a snapshot taken before the
  // earlier one landed, so the earlier one vanishes.
  it("keeps every writer's work when several run at once", async () => {
    const store = makeStore();

    await Promise.all([
      withClientLock("acme", () => store.append("web")),
      withClientLock("acme", () => store.append("android")),
      withClientLock("acme", () => store.append("ios")),
    ]);

    assert.deepEqual(store.state.entries.sort(), ["android", "ios", "web"]);
  });

  it("loses writes without the lock, which is why it exists", async () => {
    const store = makeStore();

    await Promise.all([store.append("web"), store.append("android"), store.append("ios")]);

    // Proves the interleaving is real rather than the test being trivially
    // satisfied — if this ever passes with all three, the fixture stopped
    // reproducing the race and the test above is no longer evidence.
    assert.equal(store.state.entries.length, 1);
  });

  // Counted rather than timed: a wall-clock bound turns a loaded machine into
  // a test failure that says nothing about the lock.
  function overlapProbe() {
    let inFlight = 0;
    let peak = 0;
    return {
      peak: () => peak,
      job: async () => {
        peak = Math.max(peak, (inFlight += 1));
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
      },
    };
  }

  it("runs work for different clients concurrently", async () => {
    const probe = overlapProbe();
    await Promise.all([withClientLock("a", probe.job), withClientLock("b", probe.job)]);
    assert.equal(probe.peak(), 2, "different clients must not queue behind each other");
  });

  it("never overlaps work for the same client", async () => {
    const probe = overlapProbe();
    await Promise.all([
      withClientLock("acme", probe.job),
      withClientLock("acme", probe.job),
      withClientLock("acme", probe.job),
    ]);
    assert.equal(probe.peak(), 1, "the same client must have exactly one writer at a time");
  });

  it("runs work for one client in call order", async () => {
    const order: number[] = [];
    const push = (n: number, delay: number) => async () => {
      await new Promise((resolve) => setTimeout(resolve, delay));
      order.push(n);
    };

    await Promise.all([
      withClientLock("acme", push(1, 15)),
      withClientLock("acme", push(2, 1)),
      withClientLock("acme", push(3, 1)),
    ]);

    assert.deepEqual(order, [1, 2, 3]);
  });

  // A save that throws must not wedge every later save for that client.
  it("releases the lock when work throws, and still rejects for that caller", async () => {
    const failing = withClientLock("acme", async () => {
      throw new Error("save failed");
    });
    await assert.rejects(failing, /save failed/);

    const after = await withClientLock("acme", async () => "ok");
    assert.equal(after, "ok");
  });

  it("does not retain a client once its queue drains", async () => {
    await withClientLock("acme", async () => undefined);
    assert.equal(isLocked("acme"), false);
  });

  it("reports a client as locked while work is in flight", async () => {
    let release!: () => void;
    const blocked = withClientLock("acme", () => new Promise<void>((resolve) => (release = resolve)));

    // Work is chained onto a promise rather than invoked inline — that is what
    // makes ordering deterministic — so it starts a microtask later.
    await null;

    assert.equal(isLocked("acme"), true);
    release();
    await blocked;
    assert.equal(isLocked("acme"), false);
  });
});
