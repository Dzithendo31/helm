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
import { openSession, type AgentRunner, type AgentUsage } from "../agent/runner";
import {
  DRIFT_SCHEMA,
  RESEARCH_SCHEMA,
  SPEC_RESEARCH_SCHEMA,
  SPEC_SCHEMA,
  STEER_SCHEMA,
  TASK_SCHEMA,
  WORKFLOW_SCHEMA,
  withSchema,
} from "../agent/schemas";
import { runGate } from "../teams/gate";
import type { TeamConfig, Teams } from "../teams/types";
import type { HelmConfig } from "../config";
import type { HumanInterface } from "./checkpoints";
import { noopReporter, type Reporter } from "./events";
import { noopInbox, type Inbox } from "./inbox";
import { buildWaves } from "./scheduler";
import { persistRun } from "./store";
import { runVerification, type VerificationResult } from "./verify";

/** Estimated tokens a single QA review pass would cost — for optimise-mode counterfactuals. */
const AVOIDED_REVIEW_TOKENS = 300;
const MAX_SPEC_REVISIONS = 1;
/** Rounds the Research team may take to ground the spec before it must hand back. */
const MAX_RESEARCH_ROUNDS = 2;
/** Times Dev may fix failing tests and re-verify before the run gives up. */
const MAX_FIX_ROUNDS = 2;
/** Tools the Dev team gets when `--build` is on, so it can produce real files. */
const DEV_TOOLS = ["Read", "Write", "Edit", "Bash"] as const;
/** Read-only tools the Research team gets to investigate the codebase while grounding the spec. */
const RESEARCH_READ_TOOLS = ["Read", "Grep", "Glob"] as const;

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
  /** Live progress channel (the CLI renders a spinner + step log). */
  readonly report?: Reporter;
  /** Mid-run human → orchestrator messages (drained between dependency waves). */
  readonly inbox?: Inbox;
  /** REQ #2: hand the draft spec to Research to ground it before human approval. */
  readonly groundSpec?: boolean;
  /** Test command run in the workspace to verify `tested` (build mode). Auto-detected if omitted. */
  readonly testCommand?: string;
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
  readonly verification?: VerificationResult;
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
  const execRaw = Array.isArray(d.execution) ? d.execution : Array.isArray(d.order) ? d.order : [];
  const execution = execRaw.flatMap((raw) => {
    const e = (raw ?? {}) as Record<string, unknown>;
    if (typeof e.req !== "string") return [];
    const dependsOn = Array.isArray(e.dependsOn)
      ? e.dependsOn.filter((x): x is string => typeof x === "string")
      : [];
    return [{ req: e.req, dependsOn }];
  });
  return {
    steps: Array.isArray(d.steps)
      ? d.steps.filter((s): s is string => typeof s === "string")
      : ["dev", "quality", "watchmen"],
    rationale: typeof d.rationale === "string" ? d.rationale : "",
    ...(execution.length > 0 ? { execution } : {}),
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
  const report = input.report ?? noopReporter;
  const inbox = input.inbox ?? noopInbox;
  const steering: string[] = []; // guidance the human injects mid-run, folded into later work
  const baseDir = input.baseDir ?? process.cwd();
  const devWrites = input.devWritesFiles === true && typeof input.workspace === "string";
  const devTools = devWrites ? DEV_TOOLS : undefined;
  const devCwd = devWrites ? input.workspace : undefined;
  const groundSpec = input.groundSpec === true;
  const runId = newId("run");
  let ledger = emptyLedger();
  const reviews: ReviewBody[] = [];

  // The Helm-Leader is one persistent context for the whole run: spec, workflow,
  // and mid-run steering are turns in a single session, not disconnected calls.
  const leaderCfg = teams["Helm-Leader"];
  const leader = openSession(runner, {
    team: leaderCfg.name,
    model: leaderCfg.model,
    role: leaderCfg.role,
  });

  // REQ #2: hand the draft spec to the Research team to ground it (reading code when a
  // workspace is available) until it is confident, then return the refined requirements.
  const groundDraftSpec = async (draft: ReqSeed[]): Promise<ReqSeed[]> => {
    let current = draft;
    const workspace = devWrites ? input.workspace : undefined;
    report({ kind: "begin", icon: "🔬", label: "Research · grounding the spec" });
    for (let round = 0; round < MAX_RESEARCH_ROUNDS; round += 1) {
      try {
        const res = await runner.run<{ confident?: unknown }>({
          team: teams.Research.name,
          model: teams.Research.model,
          role: teams.Research.role,
          mode: "spec-research",
          instruction: withSchema(
            `Investigate and refine this draft spec for the request: "${input.request}". ` +
              "Read the codebase if it is available to ground the requirements. CONSOLIDATE over-decomposed " +
              "requirements and merge duplicates — prefer the FEWEST, well-formed requirements (fold edge cases " +
              "into acceptance criteria, never into new requirements). Only add a requirement for genuinely " +
              "missing DISTINCT behaviour. Sharpen acceptance criteria and correct risk/confidence. Set " +
              "\"confident\" to true only when the spec is complete and correct.",
            SPEC_RESEARCH_SCHEMA,
          ),
          payload: { request: input.request, draft: current },
          ...(workspace ? { tools: [...RESEARCH_READ_TOOLS], cwd: workspace } : {}),
        });
        ledger = record(ledger, led(teams.Research, "spec", res.usage));
        const refined = parseSeeds(res.data);
        if (refined.length > 0) current = refined;
        if (res.data?.confident === true) break;
      } catch {
        // Grounding is best-effort: a timeout/error keeps the draft spec, never crashes the run.
        break;
      }
    }
    report({
      kind: "end",
      icon: "🔬",
      label: `Research · spec grounded (${current.length} requirements)`,
      status: "ok",
    });
    return current;
  };

  // ── 1. Leader writes the Spec, human approves (REQ-2, REQ-3) ───────────────
  let seeds: ReqSeed[] = [];
  let specBody: SpecBody = { title: "Spec", requirements: [] };
  let approved = false;
  let malformed = false;
  let rawSpec = "";
  let feedback: string | undefined;

  for (let attempt = 0; attempt <= MAX_SPEC_REVISIONS; attempt += 1) {
    report({ kind: "begin", icon: "⚓", label: "Helm-Leader · writing the spec" });
    const specRes = await leader.send({
      mode: "spec",
      instruction: withSchema(
        feedback
          ? `Revise the Spec given this feedback: ${feedback}`
          : `Write a MINIMAL Spec for this request: ${input.request}. Use the FEWEST requirements that capture genuinely distinct behaviour — do NOT split one function, file, or concern into multiple requirements, and fold edge cases into a single requirement's acceptance criteria. A small task is usually 1–2 requirements, rarely more than 4. Keep each statement to one concise sentence.`,
        SPEC_SCHEMA,
      ),
      payload: { request: input.request, feedback },
    });
    ledger = record(ledger, led(teams["Helm-Leader"], "spec", specRes.usage));
    rawSpec = specRes.text;
    seeds = parseSeeds(specRes.data);
    if (seeds.length === 0) {
      report({ kind: "end", icon: "⚓", label: "Spec did not parse into requirements", status: "error" });
      malformed = true;
      break;
    }
    report({ kind: "end", icon: "⚓", label: `Spec draft · ${seeds.length} requirements`, status: "ok" });
    if (groundSpec && attempt === 0) {
      seeds = await groundDraftSpec(seeds);
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
    leader.close();
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
  report({ kind: "info", icon: "✓", label: "Spec approved" });

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
  report({ kind: "begin", icon: "⚓", label: "Helm-Leader · designing the workflow" });
  const wfRes = await leader.send({
    mode: "workflow",
    instruction: withSchema("Design a workflow sized to this request's complexity.", WORKFLOW_SCHEMA),
    payload: { requirements },
  });
  ledger = record(ledger, led(teams["Helm-Leader"], "workflow", wfRes.usage));
  const workflowBody = parseWorkflow(wfRes.data);
  const workflowArtifact = createArtifact<WorkflowBody>({
    type: "Workflow",
    body: workflowBody,
    refs: requirementIds(specBody),
    state: "Accepted",
    provenance: { team: "Helm-Leader", agent: "leader", reason: "design workflow" },
  });
  report({ kind: "end", icon: "⚓", label: `Workflow · ${workflowBody.steps.length} steps`, status: "ok" });
  if (workflowBody.steps.length > 0) {
    report({ kind: "info", icon: "📐", label: "Workflow plan:" });
    workflowBody.steps.forEach((step, i) =>
      report({ kind: "info", icon: " ", label: `   ${i + 1}. ${step}` }),
    );
  }
  report({ kind: "info", icon: "⚖", label: `Triaging ${requirements.length} requirements by risk` });

  // ── 3. Per-requirement work, run by the workflow's dependency graph (REQ-4 / E) ─
  let workspaceSnapshot = devCwd ? listWorkspaceFiles(devCwd) : new Set<string>();
  const total = requirements.length;
  const reqByIndex = new Map(
    requirements.map((r, i) => [r.id, { req: r, index: i }] as const),
  );
  const waves = buildWaves(
    requirements.map((r) => r.id),
    workflowBody.execution ?? [],
  );
  // Build mode shares one workspace, so it stays sequential (no file races);
  // reasoning mode runs independent requirements in parallel.
  const concurrency = devWrites ? 1 : 4;
  const useSpinner = concurrency === 1;
  const begin = (icon: string, label: string): void =>
    report(useSpinner ? { kind: "begin", icon, label } : { kind: "info", icon, label: `${label} …` });
  const finish = (icon: string, label: string, status: "ok" | "warn" | "error"): void =>
    report(
      useSpinner
        ? { kind: "end", icon, label, status }
        : { kind: "info", icon: status === "ok" ? "✓" : status === "warn" ? "⚠" : "✗", label },
    );
  if (waves.some((w) => w.length > 1)) {
    report({
      kind: "info",
      icon: "🗂",
      label: `Execution: ${waves.map((w) => (w.length > 1 ? `(${w.join(" ∥ ")})` : w[0])).join(" → ")}`,
    });
  }

  interface ReqResult {
    readonly index: number;
    readonly task: Artifact<TaskBody>;
    readonly decision: TriageDecision;
    readonly reviews: readonly ReviewBody[];
    readonly ledgerEntries: readonly LedgerEntry[];
    readonly escalated: boolean;
  }

  const processRequirement = async (reqId: string): Promise<ReqResult> => {
    const entry = reqByIndex.get(reqId);
    if (!entry) throw new Error(`unknown requirement ${reqId}`);
    const { req, index } = entry;
    const pos = `[${index + 1}/${total}]`;
    const local: LedgerEntry[] = [];
    try {
      const hint = triageById.get(req.id) ?? { risk: "medium" as Risk, confidence: "medium" as Confidence };
      const rigor = triage(hint);
      const researched = needsResearch(rigor);
      let researchFindings = "";
      report({
        kind: "info",
        icon: "⚖",
        label: `${pos} ${req.id} · ${hint.risk} risk / ${hint.confidence} confidence → ${rigor}`,
      });

      if (researched) {
        begin("🔬", `${pos} Research · de-risking ${req.id}`);
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
        local.push(led(teams.Research, req.id, research.usage, rigor));
        if (typeof research.data?.findings === "string") researchFindings = research.data.findings;
        finish("🔬", `${pos} Research · ${req.id}`, "ok");
      }

      // Research de-risks: record the raised confidence and the rationale.
      const finalConfidence: Confidence = researched ? raiseConfidence(hint.confidence) : hint.confidence;
      const decision: TriageDecision = {
        req: req.id,
        risk: hint.risk,
        confidence: finalConfidence,
        rigor,
        researched,
        ...(hint.rationale ? { rationale: hint.rationale } : {}),
      };

      report({ kind: "info", icon: "📋", label: `${pos} Task created · ${req.id} → Dev team` });
      begin("🔨", `${pos} Dev · implementing ${req.id}`);
      const existingFiles = devCwd ? [...workspaceSnapshot].sort() : [];
      const devInstruction = devWrites
        ? [
            `Implement ONLY requirement ${req.id}: ${req.statement}.`,
            `Honor the original request's language and stack exactly: "${input.request}".`,
            `Reuse and extend the files that already exist (see existingFiles in context) — do NOT recreate them.`,
            `Do NOT add package.json, build or test config, README, or any other scaffolding or docs unless a requirement explicitly asks for it.`,
            `Write the minimum files needed for this one requirement, then report the relative paths you created or modified.`,
            `If the requirement's acceptance criteria describe testable behavior, also write a runnable test file covering them.`,
          ].join(" ")
        : `Implement ${req.id}: ${req.statement}`;
      const steered =
        steering.length > 0 ? `${devInstruction} Mid-run human guidance: ${steering.join("; ")}.` : devInstruction;
      const prod = await runner.run<Partial<TaskBody>>({
        team: teams.Dev.name,
        model: teams.Dev.model,
        role: teams.Dev.role,
        mode: "produce",
        instruction: withSchema(steered, TASK_SCHEMA),
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
      local.push(led(teams.Dev, req.id, prod.usage, rigor));
      finish("🔨", `${pos} Dev · ${req.id}`, "ok");

      const body: TaskBody = {
        title: typeof prod.data?.title === "string" ? prod.data.title : `Work for ${req.id}`,
        summary: typeof prod.data?.summary === "string" ? prod.data.summary : req.statement,
        refs: [req.id],
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
      if (critic) begin("🔎", `${pos} Quality · reviewing ${req.id}`);
      const gate = await runGate({
        artifact: draft,
        producer: teams.Dev,
        critic,
        runner,
        ledger: emptyLedger(),
        rigor,
        ...(devTools ? { producerTools: devTools } : {}),
        ...(devCwd ? { producerCwd: devCwd } : {}),
      });
      if (critic) {
        finish(
          "🔎",
          `${pos} Quality · ${req.id} (${gate.cycles} cycle${gate.cycles === 1 ? "" : "s"})`,
          gate.escalated ? "warn" : "ok",
        );
      }
      local.push(...gate.ledger.entries);

      // Ground Dev's reported files in reality (build mode is sequential, so this is safe).
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
      const fileCount = finalTask.body.files.length;
      report({
        kind: "info",
        icon: gate.escalated ? "⚠" : "✓",
        label: `${pos} ${req.id} ${gate.escalated ? "escalated to human" : "done"}${fileCount ? ` · ${fileCount} file${fileCount === 1 ? "" : "s"}` : ""}`,
        status: gate.escalated ? "warn" : "ok",
      });

      if (critic === null) {
        const reason = config.teamMode
          ? `triage skipped QA on ${req.id} (rigor: ${rigor})`
          : `team-mode off: skipped QA on ${req.id}`;
        local.push({
          team: teams.Quality.name,
          artifact: req.id,
          model: teams.Quality.model,
          inputTokens: 0,
          outputTokens: 0,
          rigor,
          potentialSavings: { tokens: AVOIDED_REVIEW_TOKENS, reason },
        });
      }

      return { index, task: finalTask, decision, reviews: [...gate.reviews], ledgerEntries: local, escalated: gate.escalated };
    } catch (err) {
      // Resilience: one agent failure degrades this requirement to NeedsHuman.
      const message = err instanceof Error ? err.message : String(err);
      const failed = transition(
        createArtifact<TaskBody>({
          type: "Task",
          body: { title: `Failed: ${req.id}`, summary: message, refs: [req.id], files: [], tested: false, reviewed: false },
          refs: [req.id],
          provenance: { team: "Dev", agent: "producer", reason: "agent call failed" },
        }),
        "NeedsHuman",
        { team: "Dev", agent: "producer", reason: message },
      );
      report({ kind: useSpinner ? "end" : "info", icon: "⚠", label: `${pos} ${req.id} failed: ${message.slice(0, 80)}`, status: "error" });
      const decision: TriageDecision = { req: req.id, risk: "medium", confidence: "medium", rigor: "self-review", researched: false };
      return { index, task: failed, decision, reviews: [], ledgerEntries: local, escalated: true };
    }
  };

  // Run each dependency wave; requirements within a wave run up to `concurrency` at a time.
  const results: ReqResult[] = [];

  // Drain any mid-run human messages and let the Leader reply + steer the rest of the run.
  const processMessages = async (): Promise<void> => {
    for (const message of inbox.drain()) {
      report({ kind: "info", icon: "💬", label: `You: ${message}` });
      try {
        const res = await leader.send<{ reply?: unknown; guidance?: unknown }>({
          mode: "steer",
          instruction: withSchema(
            `The human sent a message mid-run: "${message}". Reply briefly. If it should change the remaining work, give concrete guidance; otherwise leave guidance "".`,
            STEER_SCHEMA,
          ),
          payload: {
            spec: specBody.requirements.map((r) => ({ id: r.id, statement: r.statement })),
            done: results.map((r) => r.task.refs[0]),
          },
        });
        ledger = record(ledger, led(teams["Helm-Leader"], "steer", res.usage));
        const reply = typeof res.data?.reply === "string" && res.data.reply ? res.data.reply : "(acknowledged)";
        const guidance = typeof res.data?.guidance === "string" ? res.data.guidance.trim() : "";
        report({ kind: "info", icon: "⚓", label: `Helm-Leader: ${reply}` });
        if (guidance) steering.push(guidance);
      } catch {
        report({ kind: "info", icon: "⚠", label: "Helm-Leader could not process the message" });
      }
    }
  };

  for (const wave of waves) {
    await processMessages();
    if (wave.length > 1) {
      report({ kind: "info", icon: "▶", label: `Running ${wave.length} requirements in parallel: ${wave.join(", ")}` });
    }
    for (let i = 0; i < wave.length; i += concurrency) {
      const chunk = wave.slice(i, i + concurrency);
      results.push(...(await Promise.all(chunk.map(processRequirement))));
    }
  }
  await processMessages();
  results.sort((a, b) => a.index - b.index);

  const tasks = results.map((r) => r.task);
  const triageDecisions = results.map((r) => r.decision);
  let escalated = false;
  for (const r of results) {
    reviews.push(...r.reviews);
    for (const e of r.ledgerEntries) ledger = record(ledger, e);
    if (r.escalated) escalated = true;
  }

  // ── 3b. Verify (and fix): run the tests; if they fail, hand the output back to
  //        Dev to fix and re-run, up to a bound. `tested` becomes a verified fact. ─
  let verification: VerificationResult | undefined;
  if (devWrites && devCwd) {
    const runTests = async (label: string): Promise<VerificationResult> => {
      report({ kind: "begin", icon: "🧪", label });
      const v = await runVerification({ workspace: devCwd, command: input.testCommand ?? null });
      report({
        kind: "end",
        icon: "🧪",
        label: v.ran ? `Tests ${v.passed ? "passed" : "failed"} — ${v.command}` : "No tests to run",
        status: v.passed ? "ok" : v.ran ? "error" : "warn",
      });
      return v;
    };

    verification = await runTests("Verifying · running the test suite");

    for (let round = 1; verification.ran && !verification.passed && round <= MAX_FIX_ROUNDS; round += 1) {
      report({ kind: "begin", icon: "🔧", label: `Dev · fixing failing tests (round ${round})` });
      try {
        const fix = await runner.run({
          team: teams.Dev.name,
          model: teams.Dev.model,
          role: teams.Dev.role,
          mode: "produce",
          instruction: withSchema(
            `The test command "${verification.command}" failed. Fix the code and/or the tests so the ` +
              "suite passes. Do NOT delete or weaken tests just to make them pass. Test output follows:\n" +
              verification.output.slice(-1500),
            TASK_SCHEMA,
          ),
          payload: { request: input.request, command: verification.command },
          tools: [...DEV_TOOLS],
          cwd: devCwd,
        });
        ledger = record(ledger, led(teams.Dev, "fix", fix.usage));
        report({ kind: "end", icon: "🔧", label: `Dev · fix round ${round}`, status: "ok" });
      } catch (err) {
        // A fix attempt that times out / errors must not crash the whole run.
        report({
          kind: "end",
          icon: "🔧",
          label: `Dev · fix round ${round} abandoned: ${err instanceof Error ? err.message : String(err)}`,
          status: "error",
        });
        break;
      }
      verification = await runTests("Re-running the test suite");
    }

    if (verification.ran) {
      for (let i = 0; i < tasks.length; i += 1) {
        tasks[i] = reviseArtifact(
          tasks[i],
          { body: { ...tasks[i].body, tested: verification.passed } },
          {
            team: "Dev",
            agent: "verifier",
            reason: `tests ${verification.passed ? "passed" : "failed"} (exit ${verification.exitCode})`,
          },
        );
      }
    }
  }

  // ── 4. Watchmen: reasoning-only spec-drift check (REQ-10) ──────────────────
  // Structural matrix first, then fold in the Watchmen's semantic judgment.
  report({ kind: "begin", icon: "👁", label: "Watchmen · checking for spec drift" });
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
        ...(verification
          ? {
              tests: {
                ran: verification.ran,
                passed: verification.passed,
                command: verification.command,
                output: verification.output.slice(-600),
              },
            }
          : {}),
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
  report({
    kind: "end",
    icon: "👁",
    label: drift ? "Watchmen · DRIFT detected" : "Watchmen · no drift",
    status: drift ? "warn" : "ok",
  });
  const status: RunStatus = escalated ? "needs-human" : drift ? "halted" : "delivered";
  report({
    kind: "info",
    icon: status === "delivered" ? "🏁" : "⚠",
    label: `Run ${status}`,
    status: status === "delivered" ? "ok" : "warn",
  });

  const storeDir = await persistRun(baseDir, runId, {
    spec: specArtifact,
    workflow: workflowArtifact,
    tasks,
    reviews,
    matrix,
    ledger,
    triage: triageDecisions,
    ...(verification ? { verification } : {}),
  });

  leader.close();
  return {
    runId,
    status,
    spec: specArtifact,
    workflow: workflowArtifact,
    tasks,
    reviews,
    matrix,
    triage: triageDecisions,
    ...(verification ? { verification } : {}),
    drift,
    gaps,
    ledger,
    savings: savingsReport(ledger),
    storeDir,
  };
};
