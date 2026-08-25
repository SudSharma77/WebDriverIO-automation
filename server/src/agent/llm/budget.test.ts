import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { estimateTokens, trimHistory } from "./budget.js";

interface Msg {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}

const startsGroup = (m: Msg) => m.role === "assistant";

/** system, task, then `turns` × (assistant + two tool results). */
function conversation(turns: number, resultSize = 400): Msg[] {
  const messages: Msg[] = [
    { role: "system", content: "S".repeat(800) },
    { role: "user", content: "the task" },
  ];
  for (let i = 0; i < turns; i += 1) {
    messages.push({ role: "assistant", content: `call ${i}` });
    messages.push({ role: "tool", content: "x".repeat(resultSize) });
    messages.push({ role: "tool", content: "y".repeat(resultSize) });
  }
  return messages;
}

/**
 * The invariant both provider APIs enforce: every `tool` message must be
 * preceded, with no intervening assistant turn, by the assistant message that
 * called it. Trimming that breaks this earns a 400, not a smaller request.
 */
function toolResultsAreAnswered(messages: Msg[]): boolean {
  let sawAssistant = false;
  for (const m of messages) {
    if (m.role === "assistant") sawAssistant = true;
    else if (m.role === "tool" && !sawAssistant) return false;
    else if (m.role === "user") sawAssistant = false;
  }
  return true;
}

describe("estimateTokens", () => {
  it("is pessimistic relative to the chars/4 rule of thumb", () => {
    // 3.5 chars/token, so 350 chars must estimate above the 87 that /4 gives.
    assert.equal(estimateTokens("z".repeat(350)), 100);
  });

  it("counts objects by their serialised size", () => {
    assert.ok(estimateTokens({ a: "z".repeat(350) }) > 100);
  });

  it("treats null and undefined as free", () => {
    assert.equal(estimateTokens(null), 0);
    assert.equal(estimateTokens(undefined), 0);
  });
});

describe("trimHistory", () => {
  it("does nothing when the budget is zero", () => {
    const messages = conversation(20);
    const before = messages.length;
    assert.equal(trimHistory(messages, { overhead: 5_000, budget: 0, pinned: 2, startsGroup }), 0);
    assert.equal(messages.length, before);
  });

  it("does nothing when the request already fits", () => {
    const messages = conversation(1);
    assert.equal(trimHistory(messages, { overhead: 100, budget: 100_000, pinned: 2, startsGroup }), 0);
  });

  it("brings an overlong conversation under budget", () => {
    const messages = conversation(30);
    const budget = 4_000;
    const overhead = 1_600;

    trimHistory(messages, { overhead, budget, pinned: 2, startsGroup });

    const total = overhead + messages.reduce((sum, m) => sum + estimateTokens(m), 0);
    assert.ok(total <= budget, `expected <= ${budget}, got ${total}`);
  });

  it("keeps the system prompt and the opening task", () => {
    const messages = conversation(30);
    trimHistory(messages, { overhead: 1_600, budget: 4_000, pinned: 2, startsGroup });

    assert.equal(messages[0]?.role, "system");
    assert.equal(messages[1]?.content, "the task");
  });

  it("drops from the oldest end, keeping the most recent turn", () => {
    const messages = conversation(30);
    trimHistory(messages, { overhead: 1_600, budget: 4_000, pinned: 2, startsGroup });

    assert.equal(messages.at(-3)?.content, "call 29");
    assert.ok(!messages.some((m) => m.content === "call 0"));
  });

  it("never orphans a tool result from its call", () => {
    for (const budget of [2_000, 3_000, 4_000, 6_000, 9_000]) {
      const messages = conversation(30);
      trimHistory(messages, { overhead: 1_600, budget, pinned: 2, startsGroup });
      assert.ok(toolResultsAreAnswered(messages), `orphaned tool result at budget ${budget}`);
    }
  });

  it("keeps the newest group even when it alone exceeds the budget", () => {
    // A single tool result far larger than the whole budget: history cannot
    // fix this, and dropping everything would leave an unanswerable request.
    const messages = conversation(4, 40_000);
    trimHistory(messages, { overhead: 1_600, budget: 2_000, pinned: 2, startsGroup });

    assert.equal(messages[0]?.role, "system");
    assert.equal(messages[1]?.content, "the task");
    assert.equal(messages.at(-3)?.content, "call 3");
    assert.ok(toolResultsAreAnswered(messages));
  });

  it("preserves user/assistant alternation for the Anthropic shape", () => {
    // No in-band system message, and tool results ride on a user turn.
    const messages: Msg[] = [{ role: "user", content: "the task" }];
    for (let i = 0; i < 20; i += 1) {
      messages.push({ role: "assistant", content: `call ${i}` });
      messages.push({ role: "user", content: "r".repeat(600) });
    }

    trimHistory(messages, { overhead: 1_600, budget: 3_000, pinned: 1, startsGroup });

    assert.equal(messages[0]?.content, "the task");
    for (let i = 0; i < messages.length; i += 1) {
      const expected = i % 2 === 0 ? "user" : "assistant";
      assert.equal(messages[i]?.role, expected, `alternation broke at ${i}`);
    }
  });
});
