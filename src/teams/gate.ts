import type { Artifact } from "../core/artifact";
import { reviseArtifact } from "../core/artifact";
import type { Ledger, LedgerEntry } from "../core/ledger";
import { record } from "../core/ledger";
import { transition } from "../core/lifecycle";
import type { Finding, ReviewBody } from "../core/review";
import { blockers, hasBlockers } from "../core/review";
import type { TaskBody } from "../core/task";
import type { RigorLevel } from "../core/triage";
import type { AgentRunner } from "../agent/runner";
import { REVIEW_SCHEMA, TASK_SCHEMA, withSchema } from "../agent/schemas";
import type { TeamConfig } from "./types";

export interface GateOptions {
  readonly artifact: Artifact<TaskBody>;
  readonly producer: TeamConfig;
  /** null => no critic (team-mode off, or triage said skip) => single approval pass. */
  readonly critic: TeamConfig | null;
  readonly runner: AgentRunner;
  readonly ledger: Ledger;
  readonly rigor: RigorLevel;
  /** Tools the producer may use when revising (e.g. Dev writing files). */
  readonly producerTools?: readonly string[];
  /** Workspace the producer operates in. */
  readonly producerCwd?: string;
}

export interface GateResult {
  readonly artifact: Artifact<TaskBody>;
  readonly reviews: readonly ReviewBody[];
  readonly cycles: number;
  readonly escalated: boolean;
  readonly ledger: Ledger;
}

const entryFor = (
  team: TeamConfig,
  artifactId: string,
  rigor: RigorLevel,
  usage: { inputTokens: number; outputTokens: number },
): LedgerEntry => ({
  team: team.name,
  artifact: artifactId,
  model: team.model,
  inputTokens: usage.inputTokens,
  outputTokens: usage.outputTokens,
  rigor,
});

/** Validate findings at the agent boundary; drop anything malformed. */
const normalizeReview = (data: unknown, target: string): ReviewBody => {
  const findings: Finding[] = [];
  if (data && typeof data === "object" && Array.isArray((data as { findings?: unknown }).findings)) {
    for (const raw of (data as { findings: unknown[] }).findings) {
      if (!raw || typeof raw !== "object") continue;
      const kind = (raw as { kind?: unknown }).kind;
      const ref = (raw as { ref?: unknown }).ref;
      const message = (raw as { message?: unknown }).message;
      if (
        (kind === "Suggestion" || kind === "Blocker" || kind === "Question") &&
        typeof ref === "string" &&
        typeof message === "string"
      ) {
        findings.push({ kind, ref, message });
      }
    }
  }
  return { target, findings };
};

const normalizeTask = (data: unknown, previous: TaskBody): TaskBody => {
  if (!data || typeof data !== "object") return previous;
  const d = data as Partial<TaskBody>;
  return {
    title: typeof d.title === "string" ? d.title : previous.title,
    summary: typeof d.summary === "string" ? d.summary : previous.summary,
    refs: Array.isArray(d.refs) ? d.refs.filter((r): r is string => typeof r === "string") : previous.refs,
    // Never trust the agent's file claim; the orchestrator reconciles files against disk.
    files: previous.files,
    tested: typeof d.tested === "boolean" ? d.tested : previous.tested,
    reviewed: previous.reviewed,
  };
};

const markReviewed = (body: TaskBody): TaskBody => ({ ...body, reviewed: true });

/**
 * REQ-7: producer→critic loop bounded to `critic.maxCycles`. Approves when the
 * critic raises no blockers; escalates to NeedsHuman when blockers persist past
 * the bound. With no critic, a single self-review pass approves.
 */
export const runGate = async (opts: GateOptions): Promise<GateResult> => {
  let ledger = opts.ledger;
  const reviews: ReviewBody[] = [];

  let artifact =
    opts.artifact.state === "Draft"
      ? transition(opts.artifact, "InternalReview", {
          team: opts.producer.name,
          agent: "producer",
          reason: "enter internal review",
        })
      : opts.artifact;

  if (!opts.critic) {
    const approved = transition(
      reviseArtifact(
        artifact,
        { body: markReviewed(artifact.body) },
        { team: opts.producer.name, agent: "producer", reason: "self-review pass (no critic)" },
      ),
      "TeamApproved",
      { team: opts.producer.name, agent: "producer", reason: "approved without critique" },
    );
    return { artifact: approved, reviews, cycles: 0, escalated: false, ledger };
  }

  const critic = opts.critic;
  let cycles = 0;

  while (true) {
    const critiqueRes = await opts.runner.run({
      team: critic.name,
      model: critic.model,
      role: critic.role,
      mode: "critique",
      instruction: withSchema(
        "Review the task for blockers, suggestions, and questions.",
        REVIEW_SCHEMA,
      ),
      payload: { target: artifact.id, refs: artifact.body.refs, body: artifact.body },
    });
    ledger = record(ledger, entryFor(critic, artifact.id, opts.rigor, critiqueRes.usage));
    const review = normalizeReview(critiqueRes.data, artifact.id);
    reviews.push(review);

    if (!hasBlockers(review)) {
      const approved = transition(
        reviseArtifact(
          artifact,
          { body: markReviewed(artifact.body) },
          { team: critic.name, agent: "critic", reason: "no blockers" },
        ),
        "TeamApproved",
        { team: critic.name, agent: "critic", reason: "approved" },
      );
      return { artifact: approved, reviews, cycles, escalated: false, ledger };
    }

    cycles += 1;
    if (cycles >= critic.maxCycles) {
      const escalated = transition(artifact, "NeedsHuman", {
        team: critic.name,
        agent: "critic",
        reason: `unresolved blockers after ${cycles} cycles`,
      });
      return { artifact: escalated, reviews, cycles, escalated: true, ledger };
    }

    const reviseRes = await opts.runner.run({
      team: opts.producer.name,
      model: opts.producer.model,
      role: opts.producer.role,
      mode: "produce",
      instruction: withSchema("Revise the task to resolve the blockers.", TASK_SCHEMA),
      payload: { refs: artifact.body.refs, blockers: blockers(review), previous: artifact.body },
      ...(opts.producerTools ? { tools: opts.producerTools } : {}),
      ...(opts.producerCwd ? { cwd: opts.producerCwd } : {}),
    });
    ledger = record(ledger, entryFor(opts.producer, artifact.id, opts.rigor, reviseRes.usage));
    artifact = reviseArtifact(
      artifact,
      { body: normalizeTask(reviseRes.data, artifact.body) },
      { team: opts.producer.name, agent: "producer", reason: "revise after blockers" },
    );
  }
};
