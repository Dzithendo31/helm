import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createArtifact, reviseArtifact, type Artifact } from "../core/artifact";
import { emptyLedger, record, type Ledger, type LedgerEntry } from "../core/ledger";
import { transition } from "../core/lifecycle";
import type { ReviewBody } from "../core/review";
import { makeRequirements, type Requirement, type SpecBody } from "../core/spec";
import { toTaskRecord, type TaskBody } from "../core/task";
import {
  applySemanticDrift,
  buildMatrix,
  hasDrift,
  hasGaps,
  type ExtraneousFinding,
  type SemanticVerdict,
  type TraceMatrix,
} from "../core/traceability";
import type { Risk } from "../core/triage";
import type { AgentRunner } from "../agent/runner";
import { DRIFT_SCHEMA, TASK_SCHEMA, withSchema } from "../agent/schemas";
import type { Teams } from "../teams/types";
import type { HumanInterface } from "./checkpoints";
import type { Budget } from "./budget";
import { noopReporter, type Reporter } from "./events";
import { runVerification, type VerificationResult } from "./verify";

const DEV_TOOLS = ["Read", "Write", "Edit", "Bash"] as const;

export interface ReqArg {
  readonly id?: string;
  readonly statement: string;
  readonly acceptance?: readonly string[];
  readonly risk?: Risk;
  readonly confidence?: Risk;
}

export interface ToolkitDeps {
  readonly runner: AgentRunner;
  readonly teams: Teams;
  readonly human: HumanInterface;
  readonly budget: Budget;
  readonly request: string;
  readonly report?: Reporter;
  /** Build mode: where the Dev team writes real files. */
  readonly workspace?: string;
  readonly testCommand?: string | null;
}

/** Files present in the workspace (relative paths), ignoring deps/vcs. */
const listFiles = (dir: string): Set<string> => {
  try {
    const entries = readdirSync(dir, { recursive: true }) as string[];
    return new Set(
      entries.filter((e) => {
        if (e.includes("node_modules") || e.startsWith(".git")) return false;
        try {
          return statSync(join(dir, e)).isFile();
        } catch {
          return false;
        }
      }),
    );
  } catch {
    return new Set();
  }
};

const isRisk = (v: unknown): v is Risk => v === "low" || v === "medium" || v === "high";

/**
 * The supervisor's orchestration primitives, exposed to the Leader as tools. Each
 * method mutates accumulated run state, enforces the budget, and records the ledger.
 * The Leader calls these; the engine (not the Leader) still owns the mandatory
 * verify + drift checkpoints via `finalize()`.
 */
export class LeaderToolkit {
  spec: SpecBody | null = null;
  specApproved = false;
  requirements: Requirement[] = [];
  tasks: Artifact<TaskBody>[] = [];
  reviews: ReviewBody[] = [];
  ledger: Ledger = emptyLedger();
  matrix: TraceMatrix | null = null;
  driftChecked = false;
  verification: VerificationResult | undefined;

  private snapshot: Set<string>;
  private readonly report: Reporter;

  constructor(private readonly deps: ToolkitDeps) {
    this.report = deps.report ?? noopReporter;
    this.snapshot = deps.workspace ? listFiles(deps.workspace) : new Set();
  }

  private charge(team: string, artifact: string, usage: { inputTokens: number; outputTokens: number }): void {
    const entry: LedgerEntry = {
      team: team as LedgerEntry["team"],
      artifact,
      model: this.deps.teams.Dev.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      rigor: "self-review",
    };
    this.ledger = record(this.ledger, entry);
    this.deps.budget.charge(usage);
    this.deps.budget.countCall();
  }

  /** Record the Leader's spec and ask the human to approve it. */
  async setSpec(input: { title?: string; requirements: readonly ReqArg[] }): Promise<{ approved: boolean; feedback?: string }> {
    const seeds = input.requirements
      .filter((r) => typeof r.statement === "string" && r.statement.trim())
      .map((r) => ({
        statement: r.statement,
        acceptance: Array.isArray(r.acceptance) ? r.acceptance.filter((a): a is string => typeof a === "string") : [],
        risk: isRisk(r.risk) ? r.risk : ("medium" as Risk),
        confidence: isRisk(r.confidence) ? r.confidence : ("medium" as Risk),
      }));
    if (seeds.length === 0) return { approved: false, feedback: "no valid requirements provided" };
    this.spec = { title: input.title ?? this.deps.request, requirements: makeRequirements(seeds) };
    const decision = await this.deps.human.approveSpec(this.spec);
    if (decision.approved) {
      this.requirements = [...this.spec.requirements];
      this.specApproved = true;
    }
    return decision.approved ? { approved: true } : { approved: false, ...(decision.feedback ? { feedback: decision.feedback } : {}) };
  }

  /** Delegate one requirement to the Dev team (build mode writes real files). */
  async dispatchDev(input: { reqId: string; statement: string; acceptance?: readonly string[] }): Promise<{
    ok: boolean;
    reason?: string;
    files?: string[];
    summary?: string;
  }> {
    if (!this.specApproved) return { ok: false, reason: "spec is not approved yet — call set_spec first" };
    if (!this.deps.budget.canSpend) return { ok: false, reason: this.deps.budget.reason };

    const workspace = this.deps.workspace;
    const instruction = workspace
      ? `Implement ONLY requirement ${input.reqId}: ${input.statement}. Honor the original request's language and stack exactly: "${this.deps.request}". Reuse and extend existing files; write the minimum needed, then report the relative paths you created or modified. If the acceptance criteria describe testable behavior, also write a runnable test.`
      : `Implement ${input.reqId}: ${input.statement}`;
    const prod = await this.deps.runner.run<Partial<TaskBody>>({
      team: this.deps.teams.Dev.name,
      model: this.deps.teams.Dev.model,
      role: this.deps.teams.Dev.role,
      mode: "produce",
      instruction: withSchema(instruction, TASK_SCHEMA),
      payload: { refs: [input.reqId], requirement: { id: input.reqId, statement: input.statement, acceptance: input.acceptance ?? [] } },
      ...(workspace ? { tools: [...DEV_TOOLS], cwd: workspace } : {}),
    });
    this.charge(this.deps.teams.Dev.name, input.reqId, prod.usage);

    const body: TaskBody = {
      title: typeof prod.data?.title === "string" ? prod.data.title : `Work for ${input.reqId}`,
      summary: typeof prod.data?.summary === "string" ? prod.data.summary : input.statement,
      refs: [input.reqId],
      files: [],
      tested: typeof prod.data?.tested === "boolean" ? prod.data.tested : !workspace,
      reviewed: false,
    };
    let task = createArtifact<TaskBody>({
      type: "Task",
      body,
      refs: [input.reqId],
      provenance: { team: "Dev", agent: "producer", reason: "leader-dispatched" },
    });
    // Reconcile claimed files against what actually landed in the workspace.
    if (workspace) {
      const now = listFiles(workspace);
      const actual = [...now].filter((f) => !this.snapshot.has(f)).sort();
      this.snapshot = now;
      task = reviseArtifact(task, { body: { ...task.body, files: actual } }, { team: "Dev", agent: "verifier", reason: "reconcile files" });
    }
    this.tasks.push(task);
    this.report({ kind: "info", icon: "🔨", label: `Dev · ${input.reqId} (${task.body.files.length} files)`, status: "ok" });
    return { ok: true, files: [...task.body.files], summary: task.body.summary };
  }

  /** Mandatory checkpoints the SUPERVISOR runs after the Leader finishes: verify + drift. */
  async finalize(): Promise<{ drift: boolean; gaps: boolean }> {
    if (this.deps.workspace) {
      this.verification = await runVerification({ workspace: this.deps.workspace, command: this.deps.testCommand ?? null });
      if (this.verification.ran) {
        this.tasks = this.tasks.map((t) =>
          reviseArtifact(t, { body: { ...t.body, tested: this.verification!.passed } }, { team: "Dev", agent: "verifier", reason: `tests ${this.verification!.passed ? "passed" : "failed"}` }),
        );
      }
    }

    let matrix = buildMatrix(this.requirements, this.tasks.map(toTaskRecord));
    try {
      const watch = await this.deps.runner.run({
        team: this.deps.teams.Watchmen.name,
        model: this.deps.teams.Watchmen.model,
        role: this.deps.teams.Watchmen.role,
        mode: "drift",
        instruction: withSchema(
          "For EACH requirement, judge whether the delivered work satisfies its acceptance criteria. Then list any work that NO requirement asked for. Reason only; run nothing.",
          DRIFT_SCHEMA,
        ),
        payload: {
          requirements: this.requirements.map((r) => ({ id: r.id, statement: r.statement, acceptance: r.acceptance })),
          tasks: this.tasks.map((t) => ({ refs: t.body.refs, summary: t.body.summary, files: t.body.files })),
          ...(this.verification ? { tests: { ran: this.verification.ran, passed: this.verification.passed } } : {}),
        },
      });
      this.charge(this.deps.teams.Watchmen.name, "drift", watch.usage);
      const { verdicts, extraneous } = parseDrift(watch.data);
      matrix = applySemanticDrift(matrix, verdicts, extraneous);
    } catch {
      /* a failed Watchmen pass leaves the structural matrix */
    }
    this.matrix = matrix;
    this.driftChecked = true;
    return { drift: hasDrift(matrix), gaps: hasGaps(matrix) };
  }
}

const firstString = (...vals: unknown[]): string | undefined =>
  vals.find((v): v is string => typeof v === "string" && v.trim().length > 0);

/** Parse the Watchmen's drift verdict (mirrors the classic orchestrator's parser). */
const parseDrift = (data: unknown): { verdicts: SemanticVerdict[]; extraneous: ExtraneousFinding[] } => {
  const d = (data ?? {}) as Record<string, unknown>;
  const verdicts: SemanticVerdict[] = Array.isArray(d.requirements)
    ? d.requirements.flatMap((raw): SemanticVerdict[] => {
        const r = (raw ?? {}) as Record<string, unknown>;
        if (typeof r.id !== "string") return [];
        return [{ id: r.id, satisfied: r.satisfied !== false, ...(typeof r.reason === "string" ? { reason: r.reason } : {}) }];
      })
    : [];
  const extraneous: ExtraneousFinding[] = Array.isArray(d.extraneous)
    ? d.extraneous.flatMap((raw): ExtraneousFinding[] => {
        const e = (raw ?? {}) as Record<string, unknown>;
        const what = firstString(e.what, e.file, e.name);
        if (!what) return [];
        return [{ what, ...(typeof e.reason === "string" ? { reason: e.reason } : {}) }];
      })
    : [];
  return { verdicts, extraneous };
};
