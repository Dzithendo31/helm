import type { TeamConfig, Teams } from "./types";

/** REQ-7: the iteration bound applied to every team gate. */
export const DEFAULT_MAX_CYCLES = 3;

export interface ModelMap {
  readonly leader: string;
  readonly research: string;
  readonly dev: string;
  readonly quality: string;
  readonly watchmen: string;
}

/**
 * Optimise-aware defaults: the Leader and Watchmen (judgment-heavy, low-volume)
 * run on the strongest model; the high-volume producing teams default to a
 * mid-tier model. All overridable.
 */
export const DEFAULT_MODELS: ModelMap = {
  leader: "claude-opus-4-8",
  research: "claude-sonnet-4-6",
  dev: "claude-sonnet-4-6",
  quality: "claude-sonnet-4-6",
  watchmen: "claude-opus-4-8",
};

export const buildTeams = (
  models: ModelMap = DEFAULT_MODELS,
  maxCycles: number = DEFAULT_MAX_CYCLES,
): Teams => {
  const team = (
    name: TeamConfig["name"],
    model: string,
    role: string,
    extra: Partial<TeamConfig> = {},
  ): TeamConfig => ({
    name,
    model,
    role,
    canResearch: false,
    producesReview: false,
    maxCycles,
    ...extra,
  });

  return {
    "Helm-Leader": team(
      "Helm-Leader",
      models.leader,
      "You are the Helm-Leader. Intake the request, write a Spec of discrete ID'd requirements, design a workflow sized to complexity, triage work by risk and confidence, break ties, and own the human conversation.",
    ),
    Research: team(
      "Research",
      models.research,
      "You are the Research team. You are the only team permitted to reach outside for information. Gather and validate knowledge that de-risks high-risk, low-confidence requirements.",
      { canResearch: true },
    ),
    Dev: team(
      "Dev",
      models.dev,
      "You are the Dev team. Turn tasks into work products that fulfill their referenced requirements. Resolve blockers raised against your work.",
    ),
    Quality: team(
      "Quality",
      models.quality,
      "You are the Quality (QA) team. Review work products and produce findings as Suggestions, Blockers, or Questions, each pinned to a requirement or task. You judge quality, not spec fidelity.",
      { producesReview: true },
    ),
    Watchmen: team(
      "Watchmen",
      models.watchmen,
      "You are the Watchmen. You verify spec fidelity only, by reasoning over the traceability matrix. You never run code. Flag work that is missing or extraneous to the Spec. You halt on drift.",
    ),
  };
};
