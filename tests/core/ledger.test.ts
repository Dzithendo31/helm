import { describe, expect, test } from "vitest";
import { emptyLedger, record, savingsReport, totalTokens } from "../../src/core/ledger";

describe("ledger", () => {
  test("totals input + output tokens across entries", () => {
    let l = emptyLedger();
    l = record(l, { team: "Dev", artifact: "a", model: "m", inputTokens: 100, outputTokens: 50, rigor: "team-review" });
    l = record(l, { team: "Quality", artifact: "a", model: "m", inputTokens: 20, outputTokens: 10, rigor: "team-review" });
    expect(totalTokens(l)).toBe(180);
  });

  test("savingsReport sums counterfactual savings and lists reasons", () => {
    let l = emptyLedger();
    l = record(l, { team: "Dev", artifact: "a", model: "m", inputTokens: 100, outputTokens: 50, rigor: "skip" });
    l = record(l, {
      team: "Quality",
      artifact: "b",
      model: "m",
      inputTokens: 0,
      outputTokens: 0,
      rigor: "skip",
      potentialSavings: { tokens: 300, reason: "skipped QA on REQ-1" },
    });
    const report = savingsReport(l);
    expect(report.spentTokens).toBe(150);
    expect(report.potentialTokens).toBe(300);
    expect(report.reasons).toEqual(["skipped QA on REQ-1"]);
  });

  test("record does not mutate the input ledger", () => {
    const l0 = emptyLedger();
    record(l0, { team: "Dev", artifact: "a", model: "m", inputTokens: 1, outputTokens: 1, rigor: "skip" });
    expect(l0.entries).toHaveLength(0);
  });
});
