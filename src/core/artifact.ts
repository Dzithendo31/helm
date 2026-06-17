import { newId, nowIso } from "./ids";

/** REQ-1: artifacts are immutable, versioned objects with type, state, refs, provenance. */
export type ArtifactType =
  | "Spec"
  | "Workflow"
  | "Task"
  | "Review"
  | "Drift"
  | "Ledger";

export type LifecycleState =
  | "Draft"
  | "InternalReview"
  | "TeamApproved"
  | "CrossTeamReview"
  | "Accepted"
  | "Blocked"
  | "NeedsHuman";

export interface Provenance {
  readonly team: string;
  readonly agent: string;
  readonly at: string; // ISO timestamp
  readonly reason: string;
}

export interface Artifact<TBody = unknown> {
  readonly id: string;
  readonly type: ArtifactType;
  readonly version: number;
  readonly state: LifecycleState;
  /** Requirement ids (or task ids) this artifact relates to. */
  readonly refs: readonly string[];
  readonly provenance: readonly Provenance[];
  readonly body: TBody;
}

export interface CreateArtifactInput<TBody> {
  readonly type: ArtifactType;
  readonly body: TBody;
  readonly refs?: readonly string[];
  readonly provenance: Omit<Provenance, "at">;
  readonly state?: LifecycleState;
}

export const createArtifact = <TBody>(input: CreateArtifactInput<TBody>): Artifact<TBody> => ({
  id: newId(input.type.toLowerCase()),
  type: input.type,
  version: 1,
  state: input.state ?? "Draft",
  refs: input.refs ?? [],
  provenance: [{ ...input.provenance, at: nowIso() }],
  body: input.body,
});

export interface RevisePatch<TBody> {
  readonly body?: TBody;
  readonly state?: LifecycleState;
  readonly refs?: readonly string[];
}

/**
 * Immutable update: never mutates the input, returns a new version with the
 * provenance trail extended. (Global immutability rule.)
 */
export const reviseArtifact = <TBody>(
  artifact: Artifact<TBody>,
  patch: RevisePatch<TBody>,
  provenance: Omit<Provenance, "at">,
): Artifact<TBody> => ({
  ...artifact,
  version: artifact.version + 1,
  state: patch.state ?? artifact.state,
  refs: patch.refs ?? artifact.refs,
  body: patch.body ?? artifact.body,
  provenance: [...artifact.provenance, { ...provenance, at: nowIso() }],
});
