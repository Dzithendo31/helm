/** A dependency edge: `req` may start only once every id in `dependsOn` is done. */
export interface ExecutionEdge {
  readonly req: string;
  readonly dependsOn: readonly string[];
}

/** Body of a Workflow artifact — the Leader's plan, sized to complexity. */
export interface WorkflowBody {
  readonly steps: readonly string[];
  readonly rationale: string;
  /** The dependency graph that drives execution order and parallelism (REQ-4 / E). */
  readonly execution?: readonly ExecutionEdge[];
}
