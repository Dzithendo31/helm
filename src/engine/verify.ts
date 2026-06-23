import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Real test execution. The Watchmen never run anything; this is the Dev/QA-layer
 * verification that turns the `tested` attestation into a verified fact the
 * Watchmen can reason over.
 */
export interface VerificationResult {
  /** Whether a test command was actually run (false = nothing to run). */
  readonly ran: boolean;
  readonly command: string;
  readonly passed: boolean;
  readonly exitCode: number | null;
  /** Tail of combined stdout/stderr. */
  readonly output: string;
}

export type ShellRunner = (
  command: string,
  cwd: string,
  timeoutMs: number,
) => Promise<{ exitCode: number | null; output: string }>;

const DEFAULT_TIMEOUT_MS = 120_000;
const OUTPUT_TAIL = 2000;

/** Best-effort detection of a project's test command from its files. */
export const detectTestCommand = (workspace: string): string | null => {
  const has = (f: string): boolean => existsSync(join(workspace, f));
  if (has("package.json")) {
    try {
      const pkg = JSON.parse(readFileSync(join(workspace, "package.json"), "utf8")) as {
        scripts?: Record<string, unknown>;
      };
      if (pkg.scripts && typeof pkg.scripts.test === "string") return "npm test --silent";
    } catch {
      /* ignore malformed package.json */
    }
  }
  if (has("Cargo.toml")) return "cargo test";
  if (has("go.mod")) return "go test ./...";
  if (has("pyproject.toml") || has("setup.py") || has("conftest.py")) return "python -m pytest -q";
  return null;
};

const defaultShell: ShellRunner = (command, cwd, timeoutMs) =>
  new Promise((resolve) => {
    const child = spawn(command, { cwd, shell: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ exitCode: null, output: `${output}\n[verification timed out after ${timeoutMs}ms]` });
    }, timeoutMs);
    child.stdout.on("data", (d: Buffer) => (output += d.toString()));
    child.stderr.on("data", (d: Buffer) => (output += d.toString()));
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ exitCode: null, output: `${output}\n${String(err)}` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code, output });
    });
  });

export interface VerifyOptions {
  readonly workspace: string;
  /** Explicit command; falls back to detection when null/undefined. */
  readonly command?: string | null;
  readonly timeoutMs?: number;
  readonly exec?: ShellRunner;
}

export const runVerification = async (opts: VerifyOptions): Promise<VerificationResult> => {
  const command = opts.command ?? detectTestCommand(opts.workspace);
  if (!command) {
    return { ran: false, command: "", passed: false, exitCode: null, output: "no test command found" };
  }
  const exec = opts.exec ?? defaultShell;
  const { exitCode, output } = await exec(command, opts.workspace, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  return {
    ran: true,
    command,
    passed: exitCode === 0,
    exitCode,
    output: output.slice(-OUTPUT_TAIL),
  };
};
