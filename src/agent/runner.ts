/**
 * The agent boundary. The orchestration engine depends only on this interface,
 * so it can run fully offline (MockAgentRunner) or against the Claude Agent SDK
 * (ClaudeAgentRunner) without changing any engine logic.
 */
export type AgentMode =
  | "spec"
  | "spec-research"
  | "workflow"
  | "produce"
  | "critique"
  | "drift"
  | "steer";

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

/**
 * One turn within a persistent session. Team/model/role come from the session;
 * a turn only varies the mode, instruction, payload, and optional per-turn tools/cwd.
 */
export interface AgentTurn {
  readonly mode: AgentMode;
  readonly instruction: string;
  readonly payload?: unknown;
  readonly tools?: readonly string[];
  readonly cwd?: string;
}

export interface SessionOptions {
  readonly team: string;
  readonly model: string;
  readonly role: string;
  readonly tools?: readonly string[];
  readonly cwd?: string;
}

/**
 * A persistent agent context. Unlike `run()` (a cold completion), a session
 * retains prior turns — so the Helm-Leader stays one mind across spec, workflow,
 * and steering instead of three disconnected calls. Transport is resume-by-id:
 * each `send` is self-contained, the context lives server-side, so there is no
 * long-lived process to leak and `close()` is cheap.
 */
export interface AgentSession {
  /** The underlying session id, once known (after the first turn). */
  readonly id: string | null;
  send<T = unknown>(turn: AgentTurn): Promise<AgentResponse<T>>;
  close(): void;
}

export interface StatefulAgentRunner extends AgentRunner {
  openSession(opts: SessionOptions): AgentSession;
}

export const supportsSessions = (r: AgentRunner): r is StatefulAgentRunner =>
  typeof (r as Partial<StatefulAgentRunner>).openSession === "function";

/**
 * Open a persistent session if the runner supports one; otherwise fall back to a
 * stateless adapter that issues an independent `run()` per turn. The engine can
 * therefore always program against a session, and unknown runners still work
 * (just without continuity).
 */
export const openSession = (runner: AgentRunner, opts: SessionOptions): AgentSession => {
  if (supportsSessions(runner)) return runner.openSession(opts);
  return {
    id: null,
    send: <T>(turn: AgentTurn) =>
      runner.run<T>({
        team: opts.team,
        model: opts.model,
        role: opts.role,
        mode: turn.mode,
        instruction: turn.instruction,
        ...(turn.payload !== undefined ? { payload: turn.payload } : {}),
        ...(turn.tools ?? opts.tools ? { tools: turn.tools ?? opts.tools } : {}),
        ...(turn.cwd ?? opts.cwd ? { cwd: turn.cwd ?? opts.cwd } : {}),
      }),
    close: () => {},
  };
};
