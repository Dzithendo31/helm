/** REQ-9: Reviews are Suggestions / Blockers / Questions, each pinned to a ref. */
export type FindingKind = "Suggestion" | "Blocker" | "Question";

export interface Finding {
  readonly kind: FindingKind;
  /** A REQ id or task id this finding pins to. */
  readonly ref: string;
  readonly message: string;
}

export interface ReviewBody {
  /** Artifact id under review. */
  readonly target: string;
  readonly findings: readonly Finding[];
}

export const findingsOfKind = (review: ReviewBody, kind: FindingKind): Finding[] =>
  review.findings.filter((f) => f.kind === kind);

export const blockers = (review: ReviewBody): Finding[] => findingsOfKind(review, "Blocker");

export const questions = (review: ReviewBody): Finding[] => findingsOfKind(review, "Question");

export const hasBlockers = (review: ReviewBody): boolean => blockers(review).length > 0;
