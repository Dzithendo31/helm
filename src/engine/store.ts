import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Artifact } from "../core/artifact";
import type { Ledger } from "../core/ledger";
import type { ReviewBody } from "../core/review";
import type { SpecBody } from "../core/spec";
import { renderSpecMarkdown } from "../core/spec";
import type { TaskBody } from "../core/task";
import { renderMatrixMarkdown, type TraceMatrix } from "../core/traceability";
import { renderTriageMarkdown, type TriageDecision } from "../core/triage";
import type { WorkflowBody } from "../core/workflow";

/** REQ-15: a run persists to an inspectable, resumable `.helm/<runId>/` store. */
export interface RunStoreData {
  readonly spec: Artifact<SpecBody>;
  readonly workflow: Artifact<WorkflowBody> | null;
  readonly tasks: readonly Artifact<TaskBody>[];
  readonly reviews: readonly ReviewBody[];
  readonly matrix: TraceMatrix;
  readonly ledger: Ledger;
  readonly triage?: readonly TriageDecision[];
  /** Raw model output captured when a run fails loud (e.g. unparseable spec). */
  readonly rawSpec?: string;
}

export const runDir = (baseDir: string, runId: string): string =>
  join(baseDir, ".helm", runId);

export const persistRun = async (
  baseDir: string,
  runId: string,
  data: RunStoreData,
): Promise<string> => {
  const dir = runDir(baseDir, runId);
  await mkdir(join(dir, "tasks"), { recursive: true });
  await mkdir(join(dir, "reviews"), { recursive: true });

  await writeFile(join(dir, "spec.md"), renderSpecMarkdown(data.spec.body), "utf8");
  if (data.workflow) {
    await writeFile(join(dir, "workflow.json"), JSON.stringify(data.workflow, null, 2), "utf8");
  }
  for (const task of data.tasks) {
    await writeFile(join(dir, "tasks", `${task.id}.json`), JSON.stringify(task, null, 2), "utf8");
  }
  data.reviews.forEach(async (review, index) => {
    await writeFile(
      join(dir, "reviews", `review-${index + 1}.json`),
      JSON.stringify(review, null, 2),
      "utf8",
    );
  });
  await writeFile(join(dir, "drift.md"), renderMatrixMarkdown(data.matrix), "utf8");
  await writeFile(join(dir, "ledger.json"), JSON.stringify(data.ledger, null, 2), "utf8");
  if (data.triage && data.triage.length > 0) {
    await writeFile(join(dir, "triage.md"), renderTriageMarkdown(data.triage), "utf8");
  }
  if (data.rawSpec !== undefined) {
    await writeFile(join(dir, "spec.raw.txt"), data.rawSpec, "utf8");
  }

  return dir;
};
