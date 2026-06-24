import { renderSpecMarkdown, type SpecBody } from "../core/spec";
import { renderMatrixMarkdown } from "../core/traceability";
import { MockAgentRunner } from "../agent/mock-runner";
import { ClaudeCliRunner, killActiveClaudeProcesses } from "../agent/cli-runner";
import type { AgentRunner } from "../agent/runner";
import { applyRolesFromDir, buildTeams, type Teams } from "../teams";
import type { Reporter, RunEvent } from "../engine/events";
import { QueueInbox } from "../engine/inbox";
import type { HumanInterface, SpecDecision } from "../engine/checkpoints";
import { runHelm, type RunResult, type RunStatus } from "../engine/orchestrator";
import {
  TEAM_DEFS,
  type UiArtifact,
  type UiCommand,
  type UiEvent,
  type UiPending,
  type UiRunStatus,
  type UiState,
  type UiTeam,
} from "./contract";

const ICON_TEAM: Record<string, string> = {
  "⚓": "helm-leader",
  "🔬": "research",
  "🔨": "dev",
  "🔎": "quality",
  "👁": "watchmen",
  "🧪": "dev",
  "🔧": "dev",
};

/** Omit that distributes over the UiEvent union (plain Omit collapses to common keys). */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type UiEventInput = DistributiveOmit<UiEvent, "seq">;

/** The ledger stores tokens only; approximate cost the same way the UI mock did. */
const COST_PER_TOKEN = 0.000004;

const clock = (): string => new Date().toISOString();
const stripPrefix = (label: string): string => {
  const i = label.indexOf(" · ");
  return i === -1 ? label : label.slice(i + 3);
};

const RUN_STATUS: Record<RunStatus, UiRunStatus> = {
  delivered: "delivered",
  halted: "halted",
  "needs-human": "needs-human",
};

export interface SessionOptions {
  readonly runnerKind: "mock" | "cli";
  readonly rolesDir: string;
  readonly baseDir: string;
  readonly model?: string;
  /** When set (with the cli runner), Dev writes real files here — real builds. */
  readonly workspace?: string;
}

/**
 * One live orchestration session the UI binds to. Holds the current UiState,
 * bridges the engine's event Reporter into incremental UiEvents, and turns UI
 * commands into engine actions (spec approval, steering, config).
 */
export class UiSession {
  private state: UiState;
  private seq = 0;
  private logSeq = 0;
  private running = false;
  private readonly subscribers = new Set<(e: UiEvent) => void>();
  private readonly inbox = new QueueInbox();
  private readonly teams: Teams;
  private specResolver: ((d: SpecDecision) => void) | null = null;

  constructor(private readonly opts: SessionOptions) {
    this.teams = applyRolesFromDir(buildTeams(), opts.rolesDir);
    this.state = {
      runId: null,
      request: null,
      status: "idle",
      config: { teamMode: true, optimise: true },
      teams: TEAM_DEFS.map((t) => ({ ...t, status: "idle", task: "", tokens: 0 })),
      artifacts: [],
      log: [],
      tokens: 0,
      costUsd: 0,
      savedTokens: 0,
      pending: null,
    };
  }

  snapshot(): UiState {
    return structuredClone(this.state);
  }

  subscribe(fn: (e: UiEvent) => void): () => void {
    this.subscribers.add(fn);
    fn({ seq: ++this.seq, type: "snapshot", state: this.snapshot() });
    return () => this.subscribers.delete(fn);
  }

  private emit(e: UiEventInput): void {
    const ev = { ...e, seq: ++this.seq } as UiEvent;
    for (const fn of this.subscribers) {
      try {
        fn(ev);
      } catch {
        /* a dead subscriber shouldn't break the broadcast */
      }
    }
  }

  private log(icon: string, text: string, level: "ok" | "warn" | "error" | "info"): void {
    const line = { seq: ++this.logSeq, at: clock(), icon, text, level };
    this.state.log.push(line);
    if (this.state.log.length > 600) this.state.log.shift();
    this.emit({ type: "log", line });
  }

  private setStatus(status: UiRunStatus): void {
    this.state.status = status;
    this.emit({ type: "status", status, runId: this.state.runId });
  }

  private setTeam(id: string, patch: Partial<UiTeam>): void {
    const team = this.state.teams.find((t) => t.id === id);
    if (!team) return;
    Object.assign(team, patch);
    this.emit({ type: "team", team: { ...team } });
  }

  private addArtifact(a: UiArtifact): void {
    this.state.artifacts.push(a);
    this.emit({ type: "artifact", artifact: a });
  }

  /** The engine's Reporter, bridged into log lines + team-node status. */
  private readonly reporter: Reporter = (e: RunEvent) => {
    const level = e.status === "error" ? "error" : e.status === "warn" ? "warn" : e.kind === "info" ? "info" : "ok";
    this.log(e.icon ?? "·", e.label, level);
    const teamId = e.icon ? ICON_TEAM[e.icon] : undefined;
    if (!teamId) return;
    // begin/info => the team is working; end => it finished. (Reasoning-mode steps
    // arrive as `info` rather than begin/end, so treat those as activity too.)
    if (e.kind === "end") {
      this.setTeam(teamId, { status: e.status === "error" ? "error" : "done", task: stripPrefix(e.label) });
    } else {
      this.setTeam(teamId, { status: "active", task: stripPrefix(e.label) });
    }
  };

  private readonly human: HumanInterface = {
    approveSpec: (spec: SpecBody) =>
      new Promise<SpecDecision>((resolve) => {
        this.specResolver = resolve;
        const pending: UiPending = {
          kind: "spec",
          title: spec.title,
          detail: renderSpecMarkdown(spec),
        };
        this.state.pending = pending;
        this.setStatus("awaiting-approval");
        this.emit({ type: "pending", pending });
      }),
    answer: async () => "(ui) proceed with best judgment.",
    mustAsk: async () => "(ui) proceed.",
    close: () => {},
  };

  private makeRunner(): AgentRunner {
    if (this.opts.runnerKind === "mock") return new MockAgentRunner();
    return new ClaudeCliRunner({ timeoutMs: 600_000 });
  }

  private resetForRun(request: string, teamMode: boolean, optimise: boolean): void {
    this.state.request = request;
    this.state.runId = null;
    this.state.artifacts = [];
    this.state.tokens = 0;
    this.state.costUsd = 0;
    this.state.savedTokens = 0;
    this.state.pending = null;
    this.state.config = { teamMode, optimise };
    for (const t of this.state.teams) {
      t.status = "idle";
      t.task = "";
      t.tokens = 0;
    }
    this.emit({ type: "snapshot", state: this.snapshot() });
  }

  async start(request: string, teamMode: boolean, optimise: boolean): Promise<void> {
    if (this.running) {
      this.log("⚠", "A run is already in progress.", "warn");
      return;
    }
    this.running = true;
    this.resetForRun(request, teamMode, optimise);
    this.setStatus("running");
    this.log("⚓", `New run: ${request}`, "ok");

    try {
      const result = await runHelm({
        request,
        config: { mode: "interactive", teamMode, optimise },
        runner: this.makeRunner(),
        human: this.human,
        teams: this.opts.model ? applyRolesFromDir(buildTeams(uniformModels(this.opts.model)), this.opts.rolesDir) : this.teams,
        report: this.reporter,
        inbox: this.inbox,
        groundSpec: true,
        baseDir: this.opts.baseDir,
        ...(this.opts.workspace && this.opts.runnerKind === "cli"
          ? { devWritesFiles: true, workspace: this.opts.workspace }
          : {}),
      });
      this.finalize(result);
    } catch (err) {
      this.log("✗", `Run failed: ${err instanceof Error ? err.message : String(err)}`, "error");
      this.setStatus("error");
    } finally {
      this.running = false;
      this.specResolver = null;
      this.state.pending = null;
      this.emit({ type: "pending", pending: null });
    }
  }

  private finalize(result: RunResult): void {
    this.state.runId = result.runId;

    // Per-team token totals from the ledger.
    const teamTokens = new Map<string, number>();
    for (const entry of result.ledger.entries) {
      const id = LEDGER_TEAM[entry.team] ?? null;
      if (id) teamTokens.set(id, (teamTokens.get(id) ?? 0) + entry.inputTokens + entry.outputTokens);
    }
    for (const t of this.state.teams) {
      t.tokens = teamTokens.get(t.id) ?? 0;
      // A team that consumed tokens participated → mark it done (unless it errored).
      if (t.tokens > 0 && t.status !== "error") t.status = "done";
    }

    for (const a of artifactsFromResult(result)) this.addArtifact(a);

    this.state.tokens = result.ledger.entries.reduce((s, e) => s + e.inputTokens + e.outputTokens, 0);
    this.state.costUsd = Number((this.state.tokens * COST_PER_TOKEN).toFixed(4));
    this.state.savedTokens = result.savings.potentialTokens;
    this.emit({
      type: "tokens",
      tokens: this.state.tokens,
      costUsd: this.state.costUsd,
      savedTokens: this.state.savedTokens,
    });

    this.setStatus(RUN_STATUS[result.status]);
    this.log("🏁", `Run ${result.status}`, result.status === "delivered" ? "ok" : "warn");
  }

  command(cmd: UiCommand): { ok: boolean; error?: string } {
    switch (cmd.kind) {
      case "newRun":
        void this.start(cmd.request, cmd.teamMode ?? this.state.config.teamMode, cmd.optimise ?? this.state.config.optimise);
        return { ok: true };
      case "approveSpec":
        if (!this.specResolver) return { ok: false, error: "no spec awaiting approval" };
        this.specResolver({ approved: true });
        this.specResolver = null;
        this.state.pending = null;
        this.emit({ type: "pending", pending: null });
        this.log("✓", "Spec approved by user.", "ok");
        return { ok: true };
      case "rejectSpec":
        if (!this.specResolver) return { ok: false, error: "no spec awaiting approval" };
        this.specResolver(cmd.feedback ? { approved: false, feedback: cmd.feedback } : { approved: false });
        this.specResolver = null;
        this.state.pending = null;
        this.emit({ type: "pending", pending: null });
        this.log("✗", "Spec rejected by user.", "warn");
        return { ok: true };
      case "steer":
        this.inbox.push(cmd.message);
        this.log("💬", `You: ${cmd.message}`, "info");
        return { ok: true };
      case "answer":
        this.log("💬", `You answered ${cmd.ref}: ${cmd.text}`, "info");
        return { ok: true };
      case "setConfig": {
        if (typeof cmd.teamMode === "boolean") this.state.config.teamMode = cmd.teamMode;
        if (typeof cmd.optimise === "boolean") this.state.config.optimise = cmd.optimise;
        this.emit({ type: "config", config: { ...this.state.config } });
        return { ok: true };
      }
      case "interrupt":
        killActiveClaudeProcesses();
        this.log("⏹", "Interrupt requested — killing in-flight agents.", "warn");
        return { ok: true };
    }
  }
}

const LEDGER_TEAM: Record<string, string> = {
  "Helm-Leader": "helm-leader",
  Research: "research",
  Dev: "dev",
  Quality: "quality",
  Watchmen: "watchmen",
};

const ROLE_FROM_TEAM: Record<string, UiArtifact["role"]> = {
  "Helm-Leader": "helm",
  Research: "research",
  Dev: "dev",
  Quality: "quality",
  Watchmen: "watch",
};

function uniformModels(model: string) {
  return { leader: model, research: model, dev: model, quality: model, watchmen: model };
}

function artifactsFromResult(r: RunResult): UiArtifact[] {
  const out: UiArtifact[] = [];
  out.push({
    id: r.spec.id,
    type: "spec",
    title: r.spec.body.title,
    role: "helm",
    from: "Helm-Leader",
    content: renderSpecMarkdown(r.spec.body),
  });
  if (r.workflow) {
    out.push({
      id: r.workflow.id,
      type: "workflow",
      title: "Workflow plan",
      role: "helm",
      from: "Helm-Leader",
      content: r.workflow.body.steps.map((s, i) => `${i + 1}. ${s}`).join("\n"),
    });
  }
  for (const t of r.tasks) {
    out.push({
      id: t.id,
      type: "task",
      title: t.body.title,
      role: "dev",
      from: "Dev Team",
      ref: t.body.refs[0],
      content: `${t.body.summary}${t.body.files.length ? `\n\nFiles: ${t.body.files.join(", ")}` : ""}`,
    });
  }
  for (const rv of r.reviews) {
    for (const f of rv.findings) {
      const type = f.kind.toLowerCase() as UiArtifact["type"];
      out.push({
        id: `${rv.target}:${f.kind}:${f.ref}`,
        type,
        title: f.message.slice(0, 64),
        role: ROLE_FROM_TEAM.Quality,
        from: "Quality Team",
        ref: f.ref,
        content: f.message,
      });
    }
  }
  if (r.verification?.ran) {
    out.push({
      id: "verification",
      type: "test",
      title: `Tests ${r.verification.passed ? "passed" : "failed"}`,
      role: "dev",
      from: "Dev Team",
      content: `${r.verification.command}\n\n${r.verification.output}`,
    });
  }
  if (r.drift) {
    out.push({
      id: "drift",
      type: "drift",
      title: "Spec drift detected",
      role: "watch",
      from: "The Watchmen",
      content: renderMatrixMarkdown(r.matrix),
    });
  }
  return out;
}
