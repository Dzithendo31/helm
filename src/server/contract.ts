/**
 * The UI contract. The server maps the engine's reality (runs, artifacts, events)
 * into these shapes; the web UI consumes them over /api/state, /api/events (SSE),
 * and /api/command. Kept deliberately small and stable.
 */

export type UiRole = "helm" | "research" | "dev" | "quality" | "watch";

export type UiRunStatus =
  | "idle"
  | "running"
  | "awaiting-approval"
  | "awaiting-answer"
  | "delivered"
  | "halted"
  | "needs-human"
  | "error";

export type UiTeamStatus = "idle" | "active" | "done" | "error";

/** A team node on the canvas (Helm-Leader + the four teams). */
export interface UiTeam {
  readonly id: string;
  readonly role: UiRole;
  readonly name: string;
  status: UiTeamStatus;
  /** Current activity label, e.g. "implementing REQ-2". */
  task: string;
  tokens: number;
}

export type UiArtifactType =
  | "spec"
  | "task"
  | "suggestion"
  | "blocker"
  | "question"
  | "test"
  | "drift"
  | "workflow";

export interface UiArtifact {
  readonly id: string;
  readonly type: UiArtifactType;
  readonly title: string;
  readonly role: UiRole;
  readonly from: string;
  readonly content?: string;
  /** REQ id or task id this relates to. */
  readonly ref?: string;
}

export interface UiLogLine {
  readonly seq: number;
  readonly at: string;
  readonly icon: string;
  readonly text: string;
  readonly level: "ok" | "warn" | "error" | "info";
}

/** Something blocking the run that the human must resolve. */
export interface UiPending {
  readonly kind: "spec" | "question";
  readonly title: string;
  readonly detail: string;
  /** For questions: the finding id to answer. */
  readonly ref?: string;
}

export interface UiRequirement {
  readonly id: string;
  readonly statement: string;
}

export interface UiState {
  runId: string | null;
  request: string | null;
  status: UiRunStatus;
  config: { teamMode: boolean; optimise: boolean };
  teams: UiTeam[];
  requirements: UiRequirement[];
  artifacts: UiArtifact[];
  log: UiLogLine[];
  tokens: number;
  costUsd: number;
  savedTokens: number;
  pending: UiPending | null;
}

/** Incremental events streamed to connected clients (sequence-numbered for replay). */
export type UiEvent =
  | { seq: number; type: "snapshot"; state: UiState }
  | { seq: number; type: "status"; status: UiRunStatus; runId: string | null }
  | { seq: number; type: "team"; team: UiTeam }
  | { seq: number; type: "artifact"; artifact: UiArtifact }
  | { seq: number; type: "log"; line: UiLogLine }
  | { seq: number; type: "tokens"; tokens: number; costUsd: number; savedTokens: number }
  | { seq: number; type: "pending"; pending: UiPending | null }
  | { seq: number; type: "requirements"; requirements: UiRequirement[] }
  | { seq: number; type: "config"; config: { teamMode: boolean; optimise: boolean } };

/** Commands the UI sends to /api/command. */
export type UiCommand =
  | { kind: "newRun"; request: string; teamMode?: boolean; optimise?: boolean }
  | { kind: "approveSpec" }
  | { kind: "rejectSpec"; feedback?: string }
  | { kind: "answer"; ref: string; text: string }
  | { kind: "steer"; message: string }
  | { kind: "setConfig"; teamMode?: boolean; optimise?: boolean }
  | { kind: "interrupt" };

export const TEAM_DEFS: ReadonlyArray<{ id: string; role: UiRole; name: string }> = [
  { id: "helm-leader", role: "helm", name: "HELM-LEADER" },
  { id: "research", role: "research", name: "RESEARCH TEAM" },
  { id: "dev", role: "dev", name: "DEV TEAM" },
  { id: "quality", role: "quality", name: "QUALITY A TEAM" },
  { id: "watchmen", role: "watch", name: "THE WATCHMEN" },
];
