import type { Artifact } from "./artifact";
import type { RequirementId } from "./spec";
import type { TaskRecord } from "./traceability";

/** Body of a Task artifact — work produced by the Dev team. */
export interface TaskBody {
  readonly title: string;
  readonly summary: string;
  readonly refs: readonly RequirementId[];
  /** Files the Dev team created or modified in the workspace (empty in reasoning-only mode). */
  readonly files: readonly string[];
  /** "tested" is an attestation recorded by the team, never an execution. */
  readonly tested: boolean;
  /** Set true once the task passes its gate. */
  readonly reviewed: boolean;
}

export const toTaskRecord = (artifact: Artifact<TaskBody>): TaskRecord => ({
  id: artifact.id,
  refs: artifact.body.refs,
  reviewed: artifact.body.reviewed,
  tested: artifact.body.tested,
});
