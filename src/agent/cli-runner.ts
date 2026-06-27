import { spawn, type ChildProcess } from "node:child_process";
import type {
  AgentRequest,
  AgentResponse,
  AgentRunner,
  AgentSession,
  AgentTurn,
  AgentUsage,
  SessionOptions,
  StatefulAgentRunner,
} from "./runner";
import { buildAgentPrompt, parseJsonLoose } from "./prompt";

/** In-flight claude subprocesses, so an interrupt handler can kill them all. */
const activeChildren = new Set<ChildProcess>();

export const killActiveClaudeProcesses = (): void => {
  for (const child of activeChildren) {
    try {
      child.kill("SIGKILL");
    } catch {
      /* already gone */
    }
  }
  activeChildren.clear();
};

/**
 * Runs each agent as a `claude --print` subprocess (the "Claude Code is the
 * runtime" model). The role becomes the system prompt; every agent therefore
 * inherits Claude Code's full tool surface without Helm reimplementing any of it.
 *
 * The command executor is injectable so the prompt-building and envelope-parsing
 * are unit-testable without invoking a real `claude` binary.
 */
export interface CommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number | null;
}

export type CommandExecutor = (
  bin: string,
  args: readonly string[],
  opts: { readonly timeoutMs: number; readonly cwd?: string },
) => Promise<CommandResult>;

export interface ClaudeCliOptions {
  readonly bin?: string;
  /** Minimal context: skips CLAUDE.md/hooks/plugins — much cheaper, but needs ANTHROPIC_API_KEY. */
  readonly bare?: boolean;
  /**
   * The tools agents may use. Default: NONE — reasoning-only agents get no tools,
   * which forces a single answering turn and prevents them from wandering into a
   * full agentic session (which can balloon to millions of tokens). Pass a list
   * (e.g. ["Edit", "Write", "Bash"]) only for teams that must produce real files.
   */
  readonly allowedTools?: readonly string[];
  /** Permission mode when tools are enabled (e.g. "acceptEdits"). */
  readonly permissionMode?: string;
  readonly timeoutMs?: number;
  readonly extraArgs?: readonly string[];
  readonly exec?: CommandExecutor;
}

const DEFAULT_TIMEOUT_MS = 300_000;

const num = (v: unknown): number => (typeof v === "number" ? v : 0);

interface RawEnvelope {
  readonly result?: unknown;
  readonly is_error?: unknown;
  readonly total_cost_usd?: unknown;
  readonly session_id?: unknown;
  readonly usage?: {
    readonly input_tokens?: unknown;
    readonly output_tokens?: unknown;
    readonly cache_read_input_tokens?: unknown;
    readonly cache_creation_input_tokens?: unknown;
  };
}

/** Parse the `claude --output-format json` envelope into text + usage + session id. */
export const parseEnvelope = (
  stdout: string,
): { text: string; usage: AgentUsage; sessionId: string | null } => {
  let env: RawEnvelope;
  try {
    env = JSON.parse(stdout) as RawEnvelope;
  } catch {
    return { text: stdout, usage: { inputTokens: 0, outputTokens: 0 }, sessionId: null };
  }
  const u = env.usage ?? {};
  const inputTokens =
    num(u.input_tokens) + num(u.cache_read_input_tokens) + num(u.cache_creation_input_tokens);
  const usage: AgentUsage = {
    inputTokens,
    outputTokens: num(u.output_tokens),
    ...(typeof env.total_cost_usd === "number" ? { costUsd: env.total_cost_usd } : {}),
  };
  return {
    text: typeof env.result === "string" ? env.result : "",
    usage,
    sessionId: typeof env.session_id === "string" ? env.session_id : null,
  };
};

const defaultExec: CommandExecutor = (bin, args, opts) =>
  new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(bin, [...args], {
      stdio: ["ignore", "pipe", "pipe"],
      ...(opts.cwd ? { cwd: opts.cwd } : {}),
    });
    activeChildren.add(child);
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`claude timed out after ${opts.timeoutMs}ms`));
    }, opts.timeoutMs);
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", (err) => {
      clearTimeout(timer);
      activeChildren.delete(child);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      activeChildren.delete(child);
      resolve({ stdout, stderr, code });
    });
  });

export class ClaudeCliRunner implements StatefulAgentRunner {
  constructor(private readonly options: ClaudeCliOptions = {}) {}

  buildArgs(req: AgentRequest, resumeId?: string | null): string[] {
    const args = [
      "-p",
      buildAgentPrompt(req),
      "--output-format",
      "json",
      "--model",
      req.model,
    ];
    // On a resumed turn the session already carries the system prompt; resume by id.
    if (resumeId) {
      args.push("--resume", resumeId);
    } else {
      args.push("--system-prompt", req.role);
    }
    // Per-call tools (req.tools) take precedence over the runner default.
    const tools = req.tools ?? this.options.allowedTools ?? [];
    if (tools.length === 0) {
      args.push("--tools", ""); // disable all tools → single reasoning turn, no wandering
    } else {
      args.push("--tools", ...tools);
      args.push("--permission-mode", this.options.permissionMode ?? "acceptEdits");
    }
    if (this.options.bare) args.push("--bare");
    if (this.options.extraArgs?.length) args.push(...this.options.extraArgs);
    return args;
  }

  /** One `claude -p` invocation, optionally resuming a session. Returns the parsed envelope. */
  private async invoke<T>(
    req: AgentRequest,
    resumeId: string | null,
  ): Promise<AgentResponse<T> & { sessionId: string | null }> {
    const bin = this.options.bin ?? process.env.HELM_CLAUDE_BIN ?? "claude";
    const exec = this.options.exec ?? defaultExec;
    const timeoutMs = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    const result = await exec(bin, this.buildArgs(req, resumeId), {
      timeoutMs,
      ...(req.cwd ? { cwd: req.cwd } : {}),
    });
    if (result.code !== 0) {
      throw new Error(
        `claude exited with code ${result.code}: ${result.stderr.trim() || result.stdout.trim()}`,
      );
    }

    const { text, usage, sessionId } = parseEnvelope(result.stdout);
    return { text, data: parseJsonLoose<T>(text), usage, sessionId };
  }

  async run<T>(req: AgentRequest): Promise<AgentResponse<T>> {
    const { text, data, usage } = await this.invoke<T>(req, null);
    return { text, data, usage };
  }

  /** A persistent Leader context: each turn resumes the prior `claude` session by id. */
  openSession(opts: SessionOptions): AgentSession {
    let sessionId: string | null = null;
    let closed = false;
    const invoke = this.invoke.bind(this);
    return {
      get id() {
        return sessionId;
      },
      async send<T>(turn: AgentTurn): Promise<AgentResponse<T>> {
        if (closed) throw new Error("session is closed");
        const req: AgentRequest = {
          team: opts.team,
          model: opts.model,
          role: opts.role,
          mode: turn.mode,
          instruction: turn.instruction,
          ...(turn.payload !== undefined ? { payload: turn.payload } : {}),
          ...(turn.tools ?? opts.tools ? { tools: turn.tools ?? opts.tools } : {}),
          ...(turn.cwd ?? opts.cwd ? { cwd: turn.cwd ?? opts.cwd } : {}),
        };
        const res = await invoke<T>(req, sessionId);
        if (res.sessionId) sessionId = res.sessionId;
        return { text: res.text, data: res.data, usage: res.usage };
      },
      close() {
        closed = true;
      },
    };
  }
}
