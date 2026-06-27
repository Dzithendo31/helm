#!/usr/bin/env node
import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { createInterface, type Interface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { defaultConfig, type HelmConfig } from "./config";
import { ClaudeAgentRunner } from "./agent/claude-runner";
import { ClaudeCliRunner, killActiveClaudeProcesses } from "./agent/cli-runner";
import { MockAgentRunner } from "./agent/mock-runner";
import type { AgentRunner } from "./agent/runner";
import type { Reporter, RunEvent } from "./engine/events";
import { DEFAULT_MODELS, buildTeams, type ModelMap } from "./teams/definitions";
import { applyRolesFromDir } from "./teams/roles";
import {
  AutoApproveHuman,
  AutonomousHuman,
  ConsoleHuman,
  type HumanInterface,
} from "./engine/checkpoints";
import { runHelm } from "./engine/orchestrator";
import { QueueInbox } from "./engine/inbox";
import { savingsReport } from "./core/ledger";

/** The Helm install root (one level up from src/ or dist/), so roles and the
 * build guard work regardless of the current working directory. */
const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** True when `target` is the Helm install dir or anything inside it. */
const isInsideHelm = (target: string): boolean => {
  const rel = relative(PACKAGE_ROOT, target);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** Live terminal renderer: a spinner with elapsed time per step, plus a step log. */
const createConsoleReporter = (out: NodeJS.WriteStream = process.stdout) => {
  const tty = Boolean(out.isTTY);
  let timer: ReturnType<typeof setInterval> | null = null;
  let active: { label: string; icon: string; start: number } | null = null;
  let frame = 0;

  const clear = (): void => {
    if (tty) out.write("\r[K");
  };
  const draw = (): void => {
    if (!active) return;
    frame = (frame + 1) % SPINNER.length;
    const secs = Math.round((Date.now() - active.start) / 1000);
    clear();
    out.write(`${SPINNER[frame]} ${active.icon} ${active.label} … ${secs}s`);
  };
  const stop = (): void => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    clear();
    active = null;
  };
  const mark = (status?: RunEvent["status"]): string =>
    status === "error" ? "✗" : status === "warn" ? "⚠" : "✓";

  const report: Reporter = (e) => {
    if (e.kind === "begin") {
      stop();
      active = { label: e.label, icon: e.icon ?? "•", start: Date.now() };
      if (tty) {
        draw();
        timer = setInterval(draw, 120);
        timer.unref?.();
      } else {
        out.write(`  … ${e.label}\n`);
      }
    } else if (e.kind === "end") {
      const secs = active ? ` (${((Date.now() - active.start) / 1000).toFixed(1)}s)` : "";
      stop();
      out.write(`  ${mark(e.status)} ${e.label}${secs}\n`);
    } else {
      stop();
      out.write(`  ${e.icon ?? "·"} ${e.label}\n`);
    }
  };

  return { report, stop };
};

type RunnerKind = "cli" | "sdk" | "mock";

interface ParsedArgs {
  readonly request: string;
  readonly config: HelmConfig;
  readonly runner: RunnerKind;
  readonly bare: boolean;
  readonly build: boolean;
  readonly groundSpec: boolean;
  readonly transcript: boolean;
  readonly leaderDrives: boolean;
  readonly modelOverride?: string;
  readonly workspace?: string;
  readonly testCommand?: string;
}

const parseArgs = (argv: readonly string[]): ParsedArgs => {
  const positionals: string[] = [];
  const base = defaultConfig();
  let mode = base.mode;
  let teamMode = base.teamMode;
  let optimise = base.optimise;
  let runner: RunnerKind = "cli";
  let bare = false;
  let build = false;
  let groundSpec = true;
  let transcript = false;
  let leaderDrives = false;
  let modelOverride: string | undefined;
  let workspace: string | undefined;
  let testCommand: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--autonomous": mode = "autonomous"; break;
      case "--interactive": mode = "interactive"; break;
      case "--no-team-mode": teamMode = false; break;
      case "--no-optimise": optimise = false; break;
      case "--mock": runner = "mock"; break;
      case "--sdk": runner = "sdk"; break;
      case "--cli": runner = "cli"; break;
      case "--bare": bare = true; break;
      case "--build": build = true; break;
      case "--no-ground-spec": groundSpec = false; break;
      case "--transcript": transcript = true; break;
      case "--leader-drives": leaderDrives = true; break;
      case "--model": modelOverride = argv[++i]; break;
      case "--workspace": workspace = argv[++i]; break;
      case "--test-cmd": testCommand = argv[++i]; break;
      default:
        if (!arg.startsWith("--")) positionals.push(arg);
    }
  }

  return {
    request: positionals.join(" "),
    config: { mode, teamMode, optimise },
    runner,
    bare,
    build,
    groundSpec,
    transcript,
    leaderDrives,
    ...(modelOverride ? { modelOverride } : {}),
    ...(workspace ? { workspace } : {}),
    ...(testCommand ? { testCommand } : {}),
  };
};

const selectRunner = (kind: RunnerKind, bare: boolean, build: boolean): AgentRunner => {
  switch (kind) {
    case "mock": return new MockAgentRunner();
    case "sdk": return new ClaudeAgentRunner();
    // Agentic build calls need a longer leash than reasoning calls.
    case "cli": return new ClaudeCliRunner({ bare, timeoutMs: build ? 600_000 : 300_000 });
  }
};

const selectHuman = (config: HelmConfig, kind: RunnerKind, rl?: Interface): HumanInterface => {
  if (kind === "mock" || !process.stdin.isTTY) return new AutoApproveHuman();
  const console_ = new ConsoleHuman(rl);
  return config.mode === "autonomous" ? new AutonomousHuman(console_) : console_;
};

const uniformModels = (model: string): ModelMap => ({
  leader: model,
  research: model,
  dev: model,
  quality: model,
  watchmen: model,
});

const main = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2));
  if (!args.request) {
    process.stderr.write(
      'Usage: helm "<request>" [--cli|--sdk|--mock] [--autonomous] [--no-team-mode]\n' +
        "             [--no-optimise] [--bare] [--model <id>] [--build --workspace <dir>] [--transcript] [--leader-drives]\n",
    );
    process.exitCode = 1;
    return;
  }

  const models = args.modelOverride ? uniformModels(args.modelOverride) : DEFAULT_MODELS;
  const rolesDir = process.env.HELM_ROLES_DIR ?? join(PACKAGE_ROOT, "roles");
  const teams = applyRolesFromDir(buildTeams(models), rolesDir);

  const runner = selectRunner(args.runner, args.bare, args.build);
  const interactive = process.stdin.isTTY && args.runner !== "mock";
  const rl = interactive ? createInterface({ input: process.stdin, output: process.stdout }) : undefined;
  const human = selectHuman(args.config, args.runner, rl);
  const baseReporter = createConsoleReporter();

  // Mid-run steering: feed stdin lines to the orchestrator's inbox, but only after
  // the spec is approved (so the approval answer isn't captured as a message).
  const inbox = new QueueInbox();
  let accepting = false;
  rl?.on("line", (line) => {
    if (accepting) inbox.push(line);
  });
  const report: Reporter = (event) => {
    baseReporter.report(event);
    if (event.kind === "info" && event.label === "Spec approved" && rl) {
      accepting = true;
      process.stdout.write("  💬 (type a message + Enter anytime to steer the run)\n");
    }
  };

  // Ctrl-C: stop the spinner, kill in-flight claude subprocesses, and exit.
  let interrupting = false;
  process.on("SIGINT", () => {
    baseReporter.stop();
    if (interrupting) process.exit(130);
    interrupting = true;
    process.stderr.write("\n⏹  Interrupted — killing agents…\n");
    killActiveClaudeProcesses();
    rl?.close();
    process.exit(130);
  });

  // Improvement B: --build lets the Dev team write real files into an isolated workspace.
  let workspace: string | undefined;
  if (args.build) {
    workspace = resolve(args.workspace ?? "helm-workspace");
    if (isInsideHelm(workspace)) {
      process.stderr.write(
        "Refusing to --build into the Helm install directory (it would clobber Helm's own source). Pass --workspace <dir> outside it.\n",
      );
      process.exitCode = 1;
      return;
    }
    mkdirSync(workspace, { recursive: true });
  }

  try {
    const result = await runHelm({
      request: args.request,
      config: args.config,
      runner,
      human,
      teams,
      report,
      inbox,
      groundSpec: args.groundSpec,
      ...(args.transcript ? { recordTranscripts: true } : {}),
      ...(args.leaderDrives ? { leaderDrives: true } : {}),
      ...(args.testCommand ? { testCommand: args.testCommand } : {}),
      ...(args.build && workspace ? { devWritesFiles: true, workspace } : {}),
    });

    process.stdout.write(`\nHelm run ${result.runId} → ${result.status.toUpperCase()}\n`);
    process.stdout.write(`Spec: ${result.spec.body.requirements.length} requirements\n`);
    process.stdout.write(`Tasks: ${result.tasks.length}\n`);
    if (result.workflow && result.workflow.body.steps.length > 0) {
      process.stdout.write("Workflow:\n");
      result.workflow.body.steps.forEach((step, i) =>
        process.stdout.write(`  ${i + 1}. ${step}\n`),
      );
    }
    if (result.triage.length > 0) {
      const byRigor = result.triage.reduce<Record<string, number>>((m, t) => {
        m[t.rigor] = (m[t.rigor] ?? 0) + 1;
        return m;
      }, {});
      const summary = Object.entries(byRigor).map(([r, n]) => `${n}×${r}`).join(", ");
      const researched = result.triage.filter((t) => t.researched).length;
      process.stdout.write(`Triage: ${summary}${researched ? ` (${researched} researched)` : ""}\n`);
    }
    const files = [...new Set(result.tasks.flatMap((t) => t.body.files))];
    if (files.length > 0) {
      process.stdout.write(`Files written (${files.length}):\n`);
      for (const file of files) process.stdout.write(`  + ${file}\n`);
    }
    if (result.verification) {
      const v = result.verification;
      process.stdout.write(
        v.ran ? `Tests: ${v.passed ? "PASSED" : "FAILED"} (${v.command})\n` : "Tests: none found\n",
      );
    }
    if (result.drift) process.stdout.write("⚠ Watchmen halted on spec drift.\n");
    if (result.gaps) process.stdout.write("⚠ Coverage gaps (partial) present.\n");

    if (args.config.optimise) {
      const report = savingsReport(result.ledger);
      process.stdout.write(
        `\noptimise-mode: spent ${report.spentTokens} tokens; ~${report.potentialTokens} saved via triage.\n`,
      );
      for (const reason of report.reasons) process.stdout.write(`  · ${reason}\n`);
    }

    process.stdout.write(`\nArtifacts: ${result.storeDir}\n`);
  } finally {
    baseReporter.stop();
    human.close();
    rl?.close();
  }
};

main().catch((error: unknown) => {
  process.stderr.write(`Helm failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
