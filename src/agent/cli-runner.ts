import { spawn } from "node:child_process";
import type { AgentRequest, AgentResponse, AgentRunner, AgentUsage } from "./runner";
import { buildAgentPrompt, parseJsonLoose } from "./prompt";

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
  readonly usage?: {
    readonly input_tokens?: unknown;
    readonly output_tokens?: unknown;
    readonly cache_read_input_tokens?: unknown;
    readonly cache_creation_input_tokens?: unknown;
  };
}

/** Parse the `claude --output-format json` envelope into text + usage. */
export const parseEnvelope = (stdout: string): { text: string; usage: AgentUsage } => {
  let env: RawEnvelope;
  try {
    env = JSON.parse(stdout) as RawEnvelope;
  } catch {
    return { text: stdout, usage: { inputTokens: 0, outputTokens: 0 } };
  }
  const u = env.usage ?? {};
  const inputTokens =
    num(u.input_tokens) + num(u.cache_read_input_tokens) + num(u.cache_creation_input_tokens);
  const usage: AgentUsage = {
    inputTokens,
    outputTokens: num(u.output_tokens),
    ...(typeof env.total_cost_usd === "number" ? { costUsd: env.total_cost_usd } : {}),
  };
  return { text: typeof env.result === "string" ? env.result : "", usage };
};

const defaultExec: CommandExecutor = (bin, args, opts) =>
  new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(bin, [...args], {
      stdio: ["ignore", "pipe", "pipe"],
      ...(opts.cwd ? { cwd: opts.cwd } : {}),
    });
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
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code });
    });
  });

export class ClaudeCliRunner implements AgentRunner {
  constructor(private readonly options: ClaudeCliOptions = {}) {}

  buildArgs(req: AgentRequest): string[] {
    const args = [
      "-p",
      buildAgentPrompt(req),
      "--output-format",
      "json",
      "--model",
      req.model,
      "--system-prompt",
      req.role,
    ];
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

  async run<T>(req: AgentRequest): Promise<AgentResponse<T>> {
    const bin = this.options.bin ?? process.env.HELM_CLAUDE_BIN ?? "claude";
    const exec = this.options.exec ?? defaultExec;
    const timeoutMs = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    const result = await exec(bin, this.buildArgs(req), {
      timeoutMs,
      ...(req.cwd ? { cwd: req.cwd } : {}),
    });
    if (result.code !== 0) {
      throw new Error(
        `claude exited with code ${result.code}: ${result.stderr.trim() || result.stdout.trim()}`,
      );
    }

    const { text, usage } = parseEnvelope(result.stdout);
    return { text, data: parseJsonLoose<T>(text), usage };
  }
}
