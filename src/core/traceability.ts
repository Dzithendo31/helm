import type { Requirement, RequirementId } from "./spec";

/** REQ-6 / REQ-10: the Watchmen's traceability matrix. */
export type DriftVerdict =
  | "covered"
  | "partial"
  | "missing"
  | "extraneous"
  | "unsatisfied"; // built and present, but the Watchmen judge it does not meet acceptance criteria

export interface TaskRecord {
  readonly id: string;
  /** Requirement ids this task claims to fulfill. */
  readonly refs: readonly RequirementId[];
  readonly reviewed: boolean;
  /** "tested" is an *attestation* recorded by a team — never executed by Watchmen. */
  readonly tested: boolean;
}

export interface TraceRow {
  /** null on an extraneous row (work mapping to no known requirement). */
  readonly req: RequirementId | null;
  readonly implementedBy: readonly string[];
  readonly reviewed: boolean;
  readonly tested: boolean;
  readonly verdict: DriftVerdict;
}

export interface TraceMatrix {
  readonly rows: readonly TraceRow[];
}

const verdictFor = (hasTask: boolean, reviewed: boolean, tested: boolean): DriftVerdict => {
  if (!hasTask) return "missing";
  if (reviewed && tested) return "covered";
  return "partial";
};

export const buildMatrix = (
  requirements: readonly Requirement[],
  tasks: readonly TaskRecord[],
): TraceMatrix => {
  const knownReqIds = new Set(requirements.map((r) => r.id));
  const rows: TraceRow[] = [];

  // One row per requirement: missing / partial / covered.
  for (const req of requirements) {
    const impl = tasks.filter((t) => t.refs.includes(req.id));
    const hasTask = impl.length > 0;
    const reviewed = hasTask && impl.every((t) => t.reviewed);
    const tested = hasTask && impl.every((t) => t.tested);
    rows.push({
      req: req.id,
      implementedBy: impl.map((t) => t.id),
      reviewed,
      tested,
      verdict: verdictFor(hasTask, reviewed, tested),
    });
  }

  // Extraneous rows: tasks that map to no known requirement (scope creep).
  for (const task of tasks) {
    const mapsToKnown = task.refs.some((ref) => knownReqIds.has(ref));
    if (!mapsToKnown) {
      rows.push({
        req: null,
        implementedBy: [task.id],
        reviewed: task.reviewed,
        tested: task.tested,
        verdict: "extraneous",
      });
    }
  }

  return { rows };
};

export const rowsByVerdict = (matrix: TraceMatrix, verdict: DriftVerdict): TraceRow[] =>
  matrix.rows.filter((r) => r.verdict === verdict);

/** A reasoning-only verdict from the Watchmen agent (the semantic layer over the structural matrix). */
export interface SemanticVerdict {
  readonly id: RequirementId;
  readonly satisfied: boolean;
  readonly reason?: string;
}

export interface ExtraneousFinding {
  readonly what: string;
  readonly reason?: string;
}

/**
 * Fold the Watchmen's semantic judgment into the structural matrix:
 * - a covered/partial requirement judged NOT satisfied becomes `unsatisfied` (drift),
 * - work the Watchmen flag as scope creep becomes `extraneous` rows.
 */
export const applySemanticDrift = (
  matrix: TraceMatrix,
  verdicts: readonly SemanticVerdict[],
  extraneous: readonly ExtraneousFinding[],
): TraceMatrix => {
  const unsatisfied = new Set(verdicts.filter((v) => !v.satisfied).map((v) => v.id));
  const rows: TraceRow[] = matrix.rows.map((row) =>
    row.req && unsatisfied.has(row.req) && (row.verdict === "covered" || row.verdict === "partial")
      ? { ...row, verdict: "unsatisfied" }
      : row,
  );
  const extraRows: TraceRow[] = extraneous.map((e) => ({
    req: null,
    implementedBy: [e.what],
    reviewed: false,
    tested: false,
    verdict: "extraneous",
  }));
  return { rows: [...rows, ...extraRows] };
};

/** Drift = the directions Watchmen halt on: missing, extraneous, or unsatisfied. */
export const hasDrift = (matrix: TraceMatrix): boolean =>
  matrix.rows.some(
    (r) => r.verdict === "missing" || r.verdict === "extraneous" || r.verdict === "unsatisfied",
  );

/** Partial coverage is an incompleteness gap (escalate), not a drift halt. */
export const hasGaps = (matrix: TraceMatrix): boolean =>
  matrix.rows.some((r) => r.verdict === "partial");

export const renderMatrixMarkdown = (matrix: TraceMatrix): string => {
  const lines = ["# Drift — traceability matrix", "", "| Requirement | Implemented by | Reviewed | Tested | Verdict |", "|---|---|---|---|---|"];
  for (const row of matrix.rows) {
    lines.push(
      `| ${row.req ?? "(none)"} | ${row.implementedBy.join(", ") || "—"} | ${row.reviewed ? "✓" : "✗"} | ${row.tested ? "✓" : "✗"} | **${row.verdict}** |`,
    );
  }
  return lines.join("\n");
};
