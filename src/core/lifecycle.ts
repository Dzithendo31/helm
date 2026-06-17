import type { Artifact, LifecycleState, Provenance } from "./artifact";
import { reviseArtifact } from "./artifact";

/**
 * REQ-7 lifecycle state machine.
 *
 *   Draft ──► InternalReview ──► TeamApproved ──► CrossTeamReview ──► Accepted
 *               │  ▲                                   │
 *        blockers│  └──────────── bounce ──────────────┘
 *               ▼
 *      (any state) ──► Blocked / NeedsHuman   (escalation)
 */
const TRANSITIONS: Record<LifecycleState, readonly LifecycleState[]> = {
  Draft: ["InternalReview", "Blocked", "NeedsHuman"],
  InternalReview: ["TeamApproved", "Draft", "Blocked", "NeedsHuman"],
  TeamApproved: ["CrossTeamReview", "Accepted", "Blocked", "NeedsHuman"],
  CrossTeamReview: ["Accepted", "InternalReview", "Draft", "Blocked", "NeedsHuman"],
  Accepted: [],
  Blocked: ["Draft", "NeedsHuman"],
  NeedsHuman: ["Draft", "Accepted", "Blocked"],
};

export const canTransition = (from: LifecycleState, to: LifecycleState): boolean =>
  TRANSITIONS[from].includes(to);

export const isTerminal = (state: LifecycleState): boolean =>
  state === "Accepted" || state === "Blocked";

export class InvalidTransitionError extends Error {
  constructor(
    readonly from: LifecycleState,
    readonly to: LifecycleState,
  ) {
    super(`Invalid lifecycle transition: ${from} -> ${to}`);
    this.name = "InvalidTransitionError";
  }
}

/** Transition an artifact, enforcing the state machine. Returns a new version. */
export const transition = <T>(
  artifact: Artifact<T>,
  to: LifecycleState,
  provenance: Omit<Provenance, "at">,
): Artifact<T> => {
  if (!canTransition(artifact.state, to)) {
    throw new InvalidTransitionError(artifact.state, to);
  }
  return reviseArtifact(artifact, { state: to }, provenance);
};
