/** REQ-2: a Spec is a list of discrete, ID'd requirements with acceptance criteria. */
export type RequirementId = string; // e.g. "REQ-1"

export interface Requirement {
  readonly id: RequirementId;
  readonly statement: string;
  readonly acceptance: readonly string[];
}

export interface SpecBody {
  readonly title: string;
  readonly requirements: readonly Requirement[];
}

/** Generate stable REQ ids from a list of statements. */
export const makeRequirements = (
  items: ReadonlyArray<{ statement: string; acceptance?: readonly string[] }>,
): Requirement[] =>
  items.map((item, index) => ({
    id: `REQ-${index + 1}`,
    statement: item.statement,
    acceptance: item.acceptance ?? [],
  }));

export const requirementIds = (spec: SpecBody): RequirementId[] =>
  spec.requirements.map((r) => r.id);

/** Render a Spec as markdown for the `.helm/` store and human review. */
export const renderSpecMarkdown = (spec: SpecBody): string => {
  const lines: string[] = [`# ${spec.title}`, ""];
  for (const req of spec.requirements) {
    lines.push(`## ${req.id} — ${req.statement}`);
    if (req.acceptance.length > 0) {
      lines.push("", "Acceptance:");
      for (const a of req.acceptance) lines.push(`- ${a}`);
    }
    lines.push("");
  }
  return lines.join("\n");
};
