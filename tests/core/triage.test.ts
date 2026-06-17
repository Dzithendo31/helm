import { describe, expect, test } from "vitest";
import {
  needsResearch,
  needsTeamReview,
  raiseConfidence,
  renderTriageMarkdown,
  triage,
} from "../../src/core/triage";

describe("triage", () => {
  test("low risk + high confidence skips", () => {
    expect(triage({ risk: "low", confidence: "high" })).toBe("skip");
  });

  test("high risk + low confidence triggers research", () => {
    const rigor = triage({ risk: "high", confidence: "low" });
    expect(rigor).toBe("research-then-review");
    expect(needsResearch(rigor)).toBe(true);
    expect(needsTeamReview(rigor)).toBe(true);
  });

  test("medium risk + medium confidence needs team review but not research", () => {
    const rigor = triage({ risk: "medium", confidence: "medium" });
    expect(rigor).toBe("team-review");
    expect(needsResearch(rigor)).toBe(false);
    expect(needsTeamReview(rigor)).toBe(true);
  });

  test("low risk + medium confidence is self-review only", () => {
    const rigor = triage({ risk: "low", confidence: "medium" });
    expect(rigor).toBe("self-review");
    expect(needsTeamReview(rigor)).toBe(false);
  });

  test("research raises confidence one level, capping at high", () => {
    expect(raiseConfidence("low")).toBe("medium");
    expect(raiseConfidence("medium")).toBe("high");
    expect(raiseConfidence("high")).toBe("high");
  });

  test("renderTriageMarkdown shows risk, rigor and researched per requirement", () => {
    const md = renderTriageMarkdown([
      { req: "REQ-1", risk: "high", confidence: "medium", rigor: "research-then-review", researched: true, rationale: "novel API" },
    ]);
    expect(md).toContain("REQ-1");
    expect(md).toContain("research-then-review");
    expect(md).toContain("novel API");
    expect(md).toContain("✓");
  });
});
