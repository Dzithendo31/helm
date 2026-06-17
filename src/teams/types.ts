export type TeamName = "Helm-Leader" | "Research" | "Dev" | "Quality" | "Watchmen";

export interface TeamConfig {
  readonly name: TeamName;
  readonly model: string;
  /** System-prompt seed describing the team's charter. */
  readonly role: string;
  /** Only the Research team may reach outside (web/docs/code search). */
  readonly canResearch: boolean;
  /** QA produces Review artifacts. */
  readonly producesReview: boolean;
  /** REQ-7: max producer→critic cycles before escalation. */
  readonly maxCycles: number;
}

export type Teams = Record<TeamName, TeamConfig>;
