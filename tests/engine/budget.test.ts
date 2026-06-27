import { describe, expect, test } from "vitest";
import { Budget } from "../../src/engine/budget";

describe("Budget", () => {
  test("accumulates token cost across calls", () => {
    const b = new Budget({ maxTokens: 1000, maxToolCalls: 10 });
    b.charge({ inputTokens: 100, outputTokens: 50 });
    b.charge({ inputTokens: 30, outputTokens: 20 });
    expect(b.spentTokens).toBe(200);
    expect(b.remainingTokens).toBe(800);
    expect(b.canSpend).toBe(true);
  });

  test("is exceeded once the token ceiling is crossed", () => {
    const b = new Budget({ maxTokens: 150, maxToolCalls: 10 });
    b.charge({ inputTokens: 100, outputTokens: 60 });
    expect(b.exceeded).toBe(true);
    expect(b.canSpend).toBe(false);
    expect(b.reason).toMatch(/token budget/);
  });

  test("is exceeded once the tool-call ceiling is reached", () => {
    const b = new Budget({ maxTokens: 1_000_000, maxToolCalls: 2 });
    b.countCall();
    expect(b.canSpend).toBe(true);
    b.countCall();
    expect(b.exceeded).toBe(true);
    expect(b.reason).toMatch(/tool-call budget/);
  });
});
