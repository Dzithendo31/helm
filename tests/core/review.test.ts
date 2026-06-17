import { describe, expect, test } from "vitest";
import { blockers, hasBlockers, questions, type ReviewBody } from "../../src/core/review";

const review: ReviewBody = {
  target: "task_1",
  findings: [
    { kind: "Suggestion", ref: "REQ-1", message: "consider renaming" },
    { kind: "Blocker", ref: "REQ-1", message: "missing error handling" },
    { kind: "Question", ref: "REQ-2", message: "which timezone?" },
  ],
};

describe("review", () => {
  test("filters blockers and questions by kind", () => {
    expect(blockers(review)).toHaveLength(1);
    expect(questions(review)).toHaveLength(1);
  });

  test("hasBlockers reflects presence of a blocker", () => {
    expect(hasBlockers(review)).toBe(true);
    expect(hasBlockers({ target: "t", findings: [] })).toBe(false);
  });
});
