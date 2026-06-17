#!/usr/bin/env node
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { defaultConfig, type HelmConfig } from "./config";
import { ClaudeAgentRunner } from "./agent/claude-runner";
import { ClaudeCliRunner } from "./agent/cli-runner";
import { MockAgentRunner } from "./agent/mock-runner";
import type { AgentRunner } from "./agent/runner";
import { DEFAULT_MODELS, buildTeams, type ModelMap } from "./teams/definitions";
import { applyRolesFromDir } from "./teams/roles";
import {
  AutoApproveHuman,
  AutonomousHuman,
  ConsoleHuman,
  type HumanInterface,
} from "./engine/checkpoints";
import { runHelm } from "./engine/orchestrator";
import { savingsReport } from "./core/ledger";

type RunnerKind = "cli" | "sdk" | "mock";

interface ParsedArgs {
  readonly request: string;
  readonly config: HelmConfig;
  readonly runner: RunnerKind;
  readonly bare: boolean;
  readonly build: boolean;
  readonly modelOverride?: string;
  readonly workspace?: string;
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
  let modelOverride: string | undefined;
  let workspace: string | undefined;

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
      case "--model": modelOverride = argv[++i]; break;
      case "--workspace": workspace = argv[++i]; break;
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
    ...(modelOverride ? { modelOverride } : {}),
    ...(workspace ? { workspace } : {}),
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

const selectHuman = (config: HelmConfig, kind: RunnerKind): HumanInterface => {
  if (kind === "mock" || !process.stdin.isTTY) return new AutoApproveHuman();
  const console_ = new ConsoleHuman();
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
        "             [--no-optimise] [--bare] [--model <id>] [--build --workspace <dir>]\n",
    );
    process.exitCode = 1;
    return;
  }

  const models = args.modelOverride ? uniformModels(args.modelOverride) : DEFAULT_MODELS;
  const rolesDir = process.env.HELM_ROLES_DIR ?? "roles";
  const teams = applyRolesFromDir(buildTeams(models), rolesDir);

  const runner = selectRunner(args.runner, args.bare, args.build);
  const human = selectHuman(args.config, args.runner);

  // Improvement B: --build lets the Dev team write real files into an isolated workspace.
  let workspace: string | undefined;
  if (args.build) {
    workspace = resolve(args.workspace ?? "helm-workspace");
    if (workspace === process.cwd()) {
      process.stderr.write("Refusing to --build inside the Helm repo. Pass --workspace <dir>.\n");
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
      ...(args.build && workspace ? { devWritesFiles: true, workspace } : {}),
    });

    process.stdout.write(`\nHelm run ${result.runId} → ${result.status.toUpperCase()}\n`);
    process.stdout.write(`Spec: ${result.spec.body.requirements.length} requirements\n`);
    process.stdout.write(`Tasks: ${result.tasks.length}\n`);
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
    human.close();
  }
};

main().catch((error: unknown) => {
  process.stderr.write(`Helm failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
