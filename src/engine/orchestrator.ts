import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createArtifact, reviseArtifact, type Artifact } from "../core/artifact";
import {
  emptyLedger,
  record,
  savingsReport,
  type Ledger,
  type LedgerEntry,
  type SavingsReport,
} from "../core/ledger";
import { transition } from "../core/lifecycle";
import type { ReviewBody } from "../core/review";
import { newId } from "../core/ids";
import {
  makeRequirements,
  requirementIds,
  type Requirement,
  type SpecBody,
} from "../core/spec";
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
import {
  needsResearch,
  needsTeamReview,
  raiseConfidence,
  triage,
  type Confidence,
  type Risk,
  type RigorLevel,
  type TriageDecision,
} from "../core/triage";
import type { WorkflowBody } from "../core/workflow";
import type { AgentRunner, AgentUsage } from "../agent/runner";
import {
  DRIFT_SCHEMA,
  RESEARCH_SCHEMA,
  SPEC_SCHEMA,
  TASK_SCHEMA,
  WORKFLOW_SCHEMA,
  withSchema,
} from "../agent/schemas";
import { runGate } from "../teams/gate";
import type { TeamConfig, Teams } from "../teams/types";
import type { HelmConfig } from "../config";
import type { HumanInterface } from "./checkpoints";
import { persistRun } from "./store";

/** Estimated tokens a single QA review pass would cost — for optimise-mode counterfactuals. */
const AVOIDED_REVIEW_TOKENS = 300;
const MAX_SPEC_REVISIONS = 1;
/** Tools the Dev team gets when `--build` is on, so it can produce real files. */
const DEV_TOOLS = ["Read", "Write", "Edit", "Bash"] as const;

export type RunStatus = "delivered" | "halted" | "needs-human";

export interface RunInput {
  readonly request: string;
  readonly config: HelmConfig;
  readonly runner: AgentRunner;
  readonly human: HumanInterface;
  readonly teams: Teams;
  /** Where the `.helm/` store is written. Defaults to cwd. */
  readonly baseDir?: string;
  /** Improvement B: let the Dev team write real files into `workspace`. */
  readonly devWritesFiles?: boolean;
  /** Workspace directory Dev operates in (required when devWritesFiles is true). */
  readonly workspace?: string;
}

export interface RunResult {
  readonly runId: string;
  readonly status: RunStatus;
  readonly spec: Artifact<SpecBody>;
  readonly workflow: Artifact<WorkflowBody> | null;
  readonly tasks: readonly Artifact<TaskBody>[];
  readonly reviews: readonly ReviewBody[];
  readonly matrix: TraceMatrix;
  readonly triage: readonly TriageDecision[];
  readonly drift: boolean;
  readonly gaps: boolean;
  readonly ledger: Ledger;
  readonly savings: SavingsReport;
  readonly storeDir: string;
  /** Set when the run failed loud (e.g. the spec did not parse into requirements). */
  readonly error?: string;
}

interface ReqSeed {
  readonly statement: string;
  readonly acceptance: readonly string[];
  readonly risk: Risk;
  readonly confidence: Confidence;
  readonly rationale?: string;
}

const isLevel = (v: unknown): v is Risk =>
  v === "low" || v === "medium" || v === "high";

const firstString = (...vals: unknown[]): string | undefined =>
  vals.find((v): v is string => typeof v === "string" && v.trim().length > 0);

const stringArray = (...vals: unknown[]): string[] => {
  const arr = vals.find((v) => Array.isArray(v));
  return Array.isArray(arr) ? arr.filter((a): a is string => typeof a === "string") : [];
};

/**
 * Parse the Leader's spec output. Tolerant of the field aliases real models emit
 * (statement/title/description, acceptance/acceptance_criteria). Returns [] when
 * there is no usable requirement array — the caller fails loud rather than
 * substituting a placeholder.
 */
const parseSeeds = (data: unknown): ReqSeed[] => {
  const reqs =
    data && typeof data === "object" && Array.isArray((data as { requirements?: unknown }).requirements)
      ? (data as { requirements: unknown[] }).requirements
      : [];
  return reqs
    .map((raw): ReqSeed | null => {
      const r = (raw ?? {}) as Record<string, unknown>;
      const statement = firstString(r.statement, r.title, r.description, r.name);
      if (!statement) return null;
      const rationale = firstString(r.rationale, r.reason, r.justification);
      return {
        statement,
        acceptance: stringArray(r.acceptance, r.acceptance_criteria, r.acceptanceCriteria),
        risk: isLevel(r.risk) ? r.risk : "medium",
        confidence: isLevel(r.confidence) ? r.confidence : "medium",
        ...(rationale ? { rationale } : {}),
      };
    })
    .filter((s): s is ReqSeed => s !== null);
};

/** Parse the Watchmen's semantic verdict. Defaults to "satisfied" unless explicitly false. */
const parseDriftVerdict = (
  data: unknown,
): { verdicts: SemanticVerdict[]; extraneous: ExtraneousFinding[] } => {
  const d = (data ?? {}) as Record<string, unknown>;
  const verdicts: SemanticVerdict[] = Array.isArray(d.requirements)
    ? d.requirements.flatMap((raw): SemanticVerdict[] => {
        const r = (raw ?? {}) as Record<string, unknown>;
        if (typeof r.id !== "string") return [];
        return [
          {
            id: r.id,
            satisfied: r.satisfied !== false, // only an explicit false counts as drift
            ...(typeof r.reason === "string" ? { reason: r.reason } : {}),
          },
        ];
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

const parseWorkflow = (data: unknown): WorkflowBody => {
  const d = (data ?? {}) as Record<string, unknown>;
  return {
    steps: Array.isArray(d.steps)
      ? d.steps.filter((s): s is string => typeof s === "string")
      : ["dev", "quality", "watchmen"],
    rationale: typeof d.rationale === "string" ? d.rationale : "",
  };
};

/** Files actually present in the workspace (relative paths), ignoring deps/vcs. */
const listWorkspaceFiles = (dir: string): Set<string> => {
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

const led = (
  team: TeamConfig,
  artifact: string,
  usage: AgentUsage,
  rigor: RigorLevel = "self-review",
): LedgerEntry => ({
  team: team.name,
  artifact,
  model: team.model,
  inputTokens: usage.inputTokens,
  outputTokens: usage.outputTokens,
  rigor,
});

/** Run Helm end to end on a single request. */
export const runHelm = async (input: RunInput): Promise<RunResult> => {
  const { config, runner, human, teams } = input;
  const baseDir = input.baseDir ?? process.cwd();
  const devWrites = input.devWritesFiles === true && typeof input.workspace === "string";
  const devTools = devWrites ? DEV_TOOLS : undefined;
  const devCwd = devWrites ? input.workspace : undefined;
  const runId = newId("run");
  let ledger = emptyLedger();
  const reviews: ReviewBody[] = [];

  // ── 1. Leader writes the Spec, human approves (REQ-2, REQ-3) ───────────────
  let seeds: ReqSeed[] = [];
  let specBody: SpecBody = { title: "Spec", requirements: [] };
  let approved = false;
  let malformed = false;
  let rawSpec = "";
  let feedback: string | undefined;

  for (let attempt = 0; attempt <= MAX_SPEC_REVISIONS; attempt += 1) {
    const specRes = await runner.run({
      team: teams["Helm-Leader"].name,
      model: teams["Helm-Leader"].model,
      role: teams["Helm-Leader"].role,
      mode: "spec",
      instruction: withSchema(
        feedback
          ? `Revise the Spec given this feedback: ${feedback}`
          : `Write a Spec for this request: ${input.request}. Keep each statement to one concise sentence.`,
        SPEC_SCHEMA,
      ),
      payload: { request: input.request, feedback },
    });
    ledger = record(ledger, led(teams["Helm-Leader"], "spec", specRes.usage));
    rawSpec = specRes.text;
    seeds = parseSeeds(specRes.data);
    if (seeds.length === 0) {
      malformed = true;
      break;
    }
    const title =
      specRes.data && typeof specRes.data === "object" && typeof (specRes.data as { title?: unknown }).title === "string"
        ? (specRes.data as { title: string }).title
        : input.request;
    specBody = { title, requirements: makeRequirements(seeds) };

    const decision = await human.approveSpec(specBody);
    if (decision.approved) {
      approved = true;
      break;
    }
    feedback = decision.feedback;
    if (!feedback) break; // outright rejection, no guidance
  }

  let specArtifact = transition(
    createArtifact<SpecBody>({
      type: "Spec",
      body: specBody,
      refs: requirementIds(specBody),
      provenance: { team: "Helm-Leader", agent: "leader", reason: "draft spec" },
    }),
    "NeedsHuman",
    { team: "Helm-Leader", agent: "leader", reason: "awaiting human approval" },
  );

  if (malformed || !approved) {
    const reason = malformed ? "spec produced no parseable requirements" : "spec not approved";
    specArtifact = transition(specArtifact, "Blocked", {
      team: "Helm-Leader",
      agent: "leader",
      reason,
    });
    const matrix = buildMatrix(specBody.requirements, []);
    const storeDir = await persistRun(baseDir, runId, {
      spec: specArtifact,
      workflow: null,
      tasks: [],
      reviews,
      matrix,
      ledger,
      ...(malformed ? { rawSpec } : {}),
    });
    return {
      runId,
      status: "needs-human",
      spec: specArtifact,
      workflow: null,
      tasks: [],
      reviews,
      matrix,
      triage: [],
      drift: false,
      gaps: false,
      ledger,
      savings: savingsReport(ledger),
      storeDir,
      ...(malformed
        ? { error: `Spec did not parse into requirements. Raw output:\n${rawSpec.slice(0, 800)}` }
        : {}),
    };
  }

  specArtifact = transition(specArtifact, "Accepted", {
    team: "Helm-Leader",
    agent: "leader",
    reason: "human approved",
  });

  const requirements: readonly Requirement[] = specBody.requirements;
  const triageById = new Map<string, { risk: Risk; confidence: Confidence; rationale?: string }>();
  requirements.forEach((req, index) => {
    const seed = seeds[index];
    triageById.set(req.id, {
      risk: seed?.risk ?? "medium",
      confidence: seed?.confidence ?? "medium",
      ...(seed?.rationale ? { rationale: seed.rationale } : {}),
    });
  });

  // ── 2. Leader designs the Workflow (REQ-4) ────────────────────────────────
  const wfRes = await runner.run({
    team: teams["Helm-Leader"].name,
    model: teams["Helm-Leader"].model,
    role: teams["Helm-Leader"].role,
    mode: "workflow",
    instruction: withSchema("Design a workflow sized to this request's complexity.", WORKFLOW_SCHEMA),
    payload: { requirements },
  });
  ledger = record(ledger, led(teams["Helm-Leader"], "workflow", wfRes.usage));
  const workflowArtifact = createArtifact<WorkflowBody>({
    type: "Workflow",
    body: parseWorkflow(wfRes.data),
    refs: requirementIds(specBody),
    state: "Accepted",
    provenance: { team: "Helm-Leader", agent: "leader", reason: "design workflow" },
  });

  // ── 3. Per-requirement: triage → research? → Dev → gate (REQ-5, REQ-7, REQ-8) ─
  const tasks: Artifact<TaskBody>[] = [];
  const triageDecisions: TriageDecision[] = [];
  let escalated = false;
  let workspaceSnapshot = devCwd ? listWorkspaceFiles(devCwd) : new Set<string>();

  for (const req of requirements) {
   try {
    const hint = triageById.get(req.id) ?? { risk: "medium" as Risk, confidence: "medium" as Confidence };
    const rigor = triage(hint);
    const researched = needsResearch(rigor);
    let researchFindings = "";

    if (researched) {
      const research = await runner.run<{ findings?: unknown }>({
        team: teams.Research.name,
        model: teams.Research.model,
        role: teams.Research.role,
        mode: "produce",
        instruction: withSchema(
          `Research what is needed to de-risk ${req.id}: ${req.statement}.`,
          RESEARCH_SCHEMA,
        ),
        payload: { refs: [req.id], statement: req.statement, acceptance: req.acceptance },
      });
      ledger = record(ledger, led(teams.Research, req.id, research.usage, rigor));
      if (typeof research.data?.findings === "string") researchFindings = research.data.findings;
    }

    // Research de-risks: record the raised confidence and the rationale.
    const finalConfidence: Confidence = researched ? raiseConfidence(hint.confidence) : hint.confidence;
    triageDecisions.push({
      req: req.id,
      risk: hint.risk,
      confidence: finalConfidence,
      rigor,
      researched,
      ...(hint.rationale ? { rationale: hint.rationale } : {}),
    });

    const existingFiles = devCwd ? [...workspaceSnapshot].sort() : [];
    const devInstruction = devWrites
      ? [
          `Implement ONLY requirement ${req.id}: ${req.statement}.`,
          `Honor the original request's language and stack exactly: "${input.request}".`,
          `Reuse and extend the files that already exist (see existingFiles in context) — do NOT recreate them.`,
          `Do NOT add package.json, build or test config, README, or any other scaffolding or docs unless a requirement explicitly asks for it.`,
          `Write the minimum files needed for this one requirement, then report the relative paths you created or modified.`,
        ].join(" ")
      : `Implement ${req.id}: ${req.statement}`;
    const prod = await runner.run<Partial<TaskBody>>({
      team: teams.Dev.name,
      model: teams.Dev.model,
      role: teams.Dev.role,
      mode: "produce",
      instruction: withSchema(devInstruction, TASK_SCHEMA),
      payload: devWrites
        ? {
            refs: [req.id],
            request: input.request,
            requirement: { id: req.id, statement: req.statement, acceptance: req.acceptance },
            allRequirements: requirements.map((r) => ({ id: r.id, statement: r.statement })),
            existingFiles,
            ...(researchFindings ? { research: researchFindings } : {}),
          }
        : { refs: [req.id], ...(researchFindings ? { research: researchFindings } : {}) },
      ...(devTools ? { tools: devTools } : {}),
      ...(devCwd ? { cwd: devCwd } : {}),
    });
    ledger = record(ledger, led(teams.Dev, req.id, prod.usage, rigor));

    const body: TaskBody = {
      title: typeof prod.data?.title === "string" ? prod.data.title : `Work for ${req.id}`,
      summary: typeof prod.data?.summary === "string" ? prod.data.summary : req.statement,
      refs: [req.id],
      // Files are never taken from the agent's claim — only from disk reconciliation
      // (build mode, below). Reasoning-only runs write nothing, so this stays empty.
      files: [],
      tested: typeof prod.data?.tested === "boolean" ? prod.data.tested : devWrites ? false : true,
      reviewed: false,
    };
    const draft = createArtifact<TaskBody>({
      type: "Task",
      body,
      refs: [req.id],
      provenance: { team: "Dev", agent: "producer", reason: "draft task" },
    });

    const critic: TeamConfig | null =
      config.teamMode && needsTeamReview(rigor) ? teams.Quality : null;

    const gate = await runGate({
      artifact: draft,
      producer: teams.Dev,
      critic,
      runner,
      ledger,
      rigor,
      ...(devTools ? { producerTools: devTools } : {}),
      ...(devCwd ? { producerCwd: devCwd } : {}),
    });
    ledger = gate.ledger;
    reviews.push(...gate.reviews);

    // Ground Dev's reported files in reality: use what actually appeared on disk,
    // not what the agent claimed it wrote.
    let finalTask = gate.artifact;
    if (devWrites && devCwd) {
      const now = listWorkspaceFiles(devCwd);
      const actualFiles = [...now].filter((f) => !workspaceSnapshot.has(f)).sort();
      workspaceSnapshot = now;
      finalTask = reviseArtifact(
        finalTask,
        { body: { ...finalTask.body, files: actualFiles } },
        { team: "Dev", agent: "verifier", reason: "reconcile claimed files against workspace" },
      );
    }
    tasks.push(finalTask);
    if (gate.escalated) escalated = true;

    if (critic === null) {
      // optimise-mode: record the QA review triage let us avoid.
      const reason = config.teamMode
        ? `triage skipped QA on ${req.id} (rigor: ${rigor})`
        : `team-mode off: skipped QA on ${req.id}`;
      ledger = record(ledger, {
        team: teams.Quality.name,
        artifact: req.id,
        model: teams.Quality.model,
        inputTokens: 0,
        outputTokens: 0,
        rigor,
        potentialSavings: { tokens: AVOIDED_REVIEW_TOKENS, reason },
      });
    }
   } catch (err) {
      // Resilience: one agent failure (timeout, parse error, non-zero exit)
      // degrades this requirement to NeedsHuman instead of crashing the run.
      const message = err instanceof Error ? err.message : String(err);
      tasks.push(
        transition(
          createArtifact<TaskBody>({
            type: "Task",
            body: { title: `Failed: ${req.id}`, summary: message, refs: [req.id], files: [], tested: false, reviewed: false },
            refs: [req.id],
            provenance: { team: "Dev", agent: "producer", reason: "agent call failed" },
          }),
          "NeedsHuman",
          { team: "Dev", agent: "producer", reason: message },
        ),
      );
      escalated = true;
    }
  }

  // ── 4. Watchmen: reasoning-only spec-drift check (REQ-10) ──────────────────
  // Structural matrix first, then fold in the Watchmen's semantic judgment.
  let matrix = buildMatrix(requirements, tasks.map(toTaskRecord));
  try {
    const watch = await runner.run({
      team: teams.Watchmen.name,
      model: teams.Watchmen.model,
      role: teams.Watchmen.role,
      mode: "drift",
      instruction: withSchema(
        "For EACH requirement, judge whether the delivered work satisfies its acceptance criteria. " +
          "Then list any files or work that NO requirement asked for (scope creep). Reason only; run nothing.",
        DRIFT_SCHEMA,
      ),
      payload: {
        requirements: requirements.map((r) => ({
          id: r.id,
          statement: r.statement,
          acceptance: r.acceptance,
        })),
        tasks: tasks.map((t) => ({
          refs: t.body.refs,
          summary: t.body.summary,
          files: t.body.files,
        })),
      },
    });
    ledger = record(ledger, led(teams.Watchmen, "drift", watch.usage));
    const { verdicts, extraneous } = parseDriftVerdict(watch.data);
    matrix = applySemanticDrift(matrix, verdicts, extraneous);
  } catch {
    // Best-effort: a failed Watchmen pass leaves the structural matrix in place.
  }

  const drift = hasDrift(matrix);
  const gaps = hasGaps(matrix);
  const status: RunStatus = escalated ? "needs-human" : drift ? "halted" : "delivered";

  const storeDir = await persistRun(baseDir, runId, {
    spec: specArtifact,
    workflow: workflowArtifact,
    tasks,
    reviews,
    matrix,
    ledger,
    triage: triageDecisions,
  });

  return {
    runId,
    status,
    spec: specArtifact,
    workflow: workflowArtifact,
    tasks,
    reviews,
    matrix,
    triage: triageDecisions,
    drift,
    gaps,
    ledger,
    savings: savingsReport(ledger),
    storeDir,
  };
};
