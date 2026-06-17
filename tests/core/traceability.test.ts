import { describe, expect, test } from "vitest";
import { makeRequirements } from "../../src/core/spec";
import {
  applySemanticDrift,
  buildMatrix,
  hasDrift,
  hasGaps,
  rowsByVerdict,
  type TaskRecord,
} from "../../src/core/traceability";

const reqs = makeRequirements([{ statement: "A" }, { statement: "B" }]); // REQ-1, REQ-2

describe("traceability", () => {
  test("covered when implemented, reviewed and tested", () => {
    const tasks: TaskRecord[] = [
      { id: "t1", refs: ["REQ-1"], reviewed: true, tested: true },
      { id: "t2", refs: ["REQ-2"], reviewed: true, tested: true },
    ];
    const matrix = buildMatrix(reqs, tasks);
    expect(rowsByVerdict(matrix, "covered")).toHaveLength(2);
    expect(hasDrift(matrix)).toBe(false);
    expect(hasGaps(matrix)).toBe(false);
  });

  test("missing when a requirement has no task → drift", () => {
    const tasks: TaskRecord[] = [{ id: "t1", refs: ["REQ-1"], reviewed: true, tested: true }];
    const matrix = buildMatrix(reqs, tasks);
    expect(rowsByVerdict(matrix, "missing").map((r) => r.req)).toEqual(["REQ-2"]);
    expect(hasDrift(matrix)).toBe(true);
  });

  test("extraneous when a task maps to no known requirement → drift", () => {
    const tasks: TaskRecord[] = [
      { id: "t1", refs: ["REQ-1"], reviewed: true, tested: true },
      { id: "t2", refs: ["REQ-2"], reviewed: true, tested: true },
      { id: "t3", refs: ["REQ-99"], reviewed: true, tested: true },
    ];
    const matrix = buildMatrix(reqs, tasks);
    expect(rowsByVerdict(matrix, "extraneous").map((r) => r.implementedBy.flat())).toEqual([["t3"]]);
    expect(hasDrift(matrix)).toBe(true);
  });

  test("applySemanticDrift downgrades a covered-but-unsatisfying requirement to drift", () => {
    const tasks: TaskRecord[] = [
      { id: "t1", refs: ["REQ-1"], reviewed: true, tested: true },
      { id: "t2", refs: ["REQ-2"], reviewed: true, tested: true },
    ];
    const structural = buildMatrix(reqs, tasks);
    expect(hasDrift(structural)).toBe(false); // structurally clean

    const judged = applySemanticDrift(
      structural,
      [{ id: "REQ-2", satisfied: false, reason: "ignores acceptance criteria" }],
      [],
    );
    expect(rowsByVerdict(judged, "unsatisfied").map((r) => r.req)).toEqual(["REQ-2"]);
    expect(hasDrift(judged)).toBe(true); // the Watchmen caught it
  });

  test("applySemanticDrift adds extraneous rows for flagged scope creep", () => {
    const structural = buildMatrix(reqs, [
      { id: "t1", refs: ["REQ-1"], reviewed: true, tested: true },
      { id: "t2", refs: ["REQ-2"], reviewed: true, tested: true },
    ]);
    const judged = applySemanticDrift(structural, [], [{ what: "tsconfig.json", reason: "not asked for" }]);
    expect(rowsByVerdict(judged, "extraneous").map((r) => r.implementedBy.flat())).toEqual([["tsconfig.json"]]);
    expect(hasDrift(judged)).toBe(true);
  });

  test("partial when implemented but not tested → gap, not drift", () => {
    const tasks: TaskRecord[] = [
      { id: "t1", refs: ["REQ-1"], reviewed: true, tested: false },
      { id: "t2", refs: ["REQ-2"], reviewed: true, tested: true },
    ];
    const matrix = buildMatrix(reqs, tasks);
    expect(rowsByVerdict(matrix, "partial").map((r) => r.req)).toEqual(["REQ-1"]);
    expect(hasDrift(matrix)).toBe(false);
    expect(hasGaps(matrix)).toBe(true);
  });
});
