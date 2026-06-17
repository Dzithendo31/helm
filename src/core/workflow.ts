/** Body of a Workflow artifact — the Leader's plan, sized to complexity. */
export interface WorkflowBody {
  readonly steps: readonly string[];
  readonly rationale: string;
}
