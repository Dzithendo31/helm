/** REQ-5: triage each work unit by risk × confidence into a rigor level. */
export type Risk = "low" | "medium" | "high";
export type Confidence = "low" | "medium" | "high";
export type RigorLevel = "skip" | "self-review" | "team-review" | "research-then-review";

/**
 * The triage matrix. Rigor rises with risk and falls with confidence.
 * High risk + low confidence is the only case that warrants research.
 */
const MATRIX: Record<Risk, Record<Confidence, RigorLevel>> = {
  low: { high: "skip", medium: "self-review", low: "self-review" },
  medium: { high: "self-review", medium: "team-review", low: "team-review" },
  high: { high: "team-review", medium: "team-review", low: "research-then-review" },
};

export interface TriageInput {
  readonly risk: Risk;
  readonly confidence: Confidence;
}

export const triage = ({ risk, confidence }: TriageInput): RigorLevel =>
  MATRIX[risk][confidence];

export const needsResearch = (rigor: RigorLevel): boolean => rigor === "research-then-review";

export const needsTeamReview = (rigor: RigorLevel): boolean =>
  rigor === "team-review" || rigor === "research-then-review";

/** Ordinal cost of a rigor level, for optimise-mode counterfactuals. */
export const rigorCost = (rigor: RigorLevel): number =>
  ({ skip: 0, "self-review": 1, "team-review": 2, "research-then-review": 3 })[rigor];

/** Research de-risks: it raises confidence one level. */
export const raiseConfidence = (confidence: Confidence): Confidence =>
  confidence === "low" ? "medium" : "high";

/** A persisted, auditable triage decision — makes "spend proportional to risk" visible. */
export interface TriageDecision {
  readonly req: string;
  readonly risk: Risk;
  readonly confidence: Confidence;
  readonly rigor: RigorLevel;
  readonly researched: boolean;
  readonly rationale?: string;
}

export const renderTriageMarkdown = (decisions: readonly TriageDecision[]): string => {
  const lines = [
    "# Triage — rigor proportional to risk",
    "",
    "| Requirement | Risk | Confidence | Rigor | Researched | Rationale |",
    "|---|---|---|---|---|---|",
  ];
  for (const d of decisions) {
    lines.push(
      `| ${d.req} | ${d.risk} | ${d.confidence} | ${d.rigor} | ${d.researched ? "✓" : "—"} | ${d.rationale ?? ""} |`,
    );
  }
  return lines.join("\n");
};
