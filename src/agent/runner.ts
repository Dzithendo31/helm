/**
 * The agent boundary. The orchestration engine depends only on this interface,
 * so it can run fully offline (MockAgentRunner) or against the Claude Agent SDK
 * (ClaudeAgentRunner) without changing any engine logic.
 */
export type AgentMode = "spec" | "workflow" | "produce" | "critique" | "drift";

export interface AgentRequest {
  readonly team: string;
  readonly model: string;
  readonly role: string;
  readonly mode: AgentMode;
  readonly instruction: string;
  readonly payload?: unknown;
  /** Tools this specific call may use. Empty/undefined => reasoning-only (no tools). */
  readonly tools?: readonly string[];
  /** Working directory for this call (where file-writing agents operate). */
  readonly cwd?: string;
}

export interface AgentUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** Real USD cost, when the runner can report it (Claude CLI does). */
  readonly costUsd?: number;
}

export interface AgentResponse<T = unknown> {
  readonly text: string;
  readonly data: T;
  readonly usage: AgentUsage;
}

export interface AgentRunner {
  run<T = unknown>(req: AgentRequest): Promise<AgentResponse<T>>;
}
