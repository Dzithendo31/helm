import { createArtifact } from "../core/artifact";
import { transition } from "../core/lifecycle";
import { savingsReport } from "../core/ledger";
import { requirementIds, type SpecBody } from "../core/spec";
import { newId } from "../core/ids";
import { buildLeaderMcpServer } from "../agent/leader-mcp";
import { Budget } from "./budget";
import { LeaderToolkit } from "./leader-toolkit";
import { noopReporter } from "./events";
import { persistRun } from "./store";
import type { RunInput, RunResult } from "./orchestrator";

/**
 * Phase 4 — the Leader DRIVES the run. Instead of the engine sequencing fixed
 * steps, the Leader (an SDK session with in-process MCP tools) decides: it writes
 * the spec, gets human approval, and delegates each requirement to Dev via tools.
 * The engine is the supervisor: it owns the budget fence and runs the mandatory
 * verify + drift checkpoints after the Leader signals completion.
 *
 * This path requires the Claude Agent SDK (in-process MCP), so worker calls go
 * through `input.runner` while the Leader is driven by the SDK directly.
 */
export const runHelmAgentic = async (input: RunInput): Promise<RunResult> => {
  const report = input.report ?? noopReporter;
  const baseDir = input.baseDir ?? process.cwd();
  const runId = newId("run");
  const workspace = input.devWritesFiles === true && typeof input.workspace === "string" ? input.workspace : undefined;
  const budget = new Budget(input.budget);
  const leaderCfg = input.teams["Helm-Leader"];

  const kit = new LeaderToolkit({
    runner: input.runner,
    teams: input.teams,
    human: input.human,
    budget,
    request: input.request,
    report,
    ...(workspace ? { workspace } : {}),
    ...(input.testCommand ? { testCommand: input.testCommand } : {}),
  });

  report({ kind: "begin", icon: "⚓", label: "Helm-Leader · driving the run" });
  try {
    // In-process MCP tool calls (human approval) can outlast the SDK's default
    // stream-close window; widen it so an awaiting-approval tool doesn't get cut.
    if (!process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT) process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT = "600000";

    const { query } = await import("@anthropic-ai/claude-agent-sdk");
    const server = buildLeaderMcpServer(kit);
    const readTools = workspace ? ["Read", "Grep", "Glob"] : [];
    const drive =
      `Orchestrate this request to completion: "${input.request}".\n\n` +
      `Drive it with your tools — do not write any files yourself:\n` +
      `1. ${workspace ? "Inspect the existing codebase with Read/Grep/Glob, then c" : "C"}all set_spec with the FEWEST distinct requirements (fold edge cases into acceptance criteria). If it returns approved:false, revise and call set_spec again.\n` +
      `2. Once approved, call dispatch_dev once for EACH requirement to delegate it to the Dev team.\n` +
      `3. When every requirement has been dispatched, call mark_complete.`;

    const stream = query({
      prompt: drive,
      options: {
        model: leaderCfg.model,
        systemPrompt: leaderCfg.role,
        mcpServers: { helm: server },
        allowedTools: ["mcp__helm__set_spec", "mcp__helm__dispatch_dev", "mcp__helm__mark_complete", ...readTools],
        maxTurns: 40, // turn fence (R4) on top of the token/tool budget
        ...(workspace ? { cwd: workspace } : {}),
      },
    }) as AsyncIterable<Record<string, unknown>>;
    // Drain the Leader's loop; tool handlers mutate `kit` as they fire.
    for await (const _ of stream) void _;
  } catch (err) {
    report({ kind: "end", icon: "⚓", label: `Leader loop ended: ${err instanceof Error ? err.message : String(err)}`, status: "warn" });
  }
  report({ kind: "end", icon: "⚓", label: `Helm-Leader · dispatched ${kit.tasks.length} task${kit.tasks.length === 1 ? "" : "s"}`, status: "ok" });

  // Supervisor-owned mandatory checkpoints (I3): always verify + drift before delivery.
  const spec: SpecBody = kit.spec ?? { title: input.request, requirements: [] };
  // Lifecycle: Draft → NeedsHuman → Accepted (the gate is the human approval).
  let specArtifact = transition(
    createArtifact<SpecBody>({ type: "Spec", body: spec, refs: requirementIds(spec), provenance: { team: "Helm-Leader", agent: "leader", reason: "leader spec" } }),
    "NeedsHuman",
    { team: "Helm-Leader", agent: "leader", reason: "awaiting human approval" },
  );
  if (kit.specApproved) {
    specArtifact = transition(specArtifact, "Accepted", { team: "Helm-Leader", agent: "leader", reason: "human approved" });
  }

  let drift = false;
  let gaps = false;
  if (kit.specApproved && kit.tasks.length > 0) {
    report({ kind: "begin", icon: "👁", label: "Watchmen · checking for spec drift" });
    const out = await kit.finalize();
    drift = out.drift;
    gaps = out.gaps;
    report({ kind: "end", icon: "👁", label: drift ? "Watchmen · DRIFT detected" : "Watchmen · no drift", status: drift ? "warn" : "ok" });
  }

  const matrix = kit.matrix ?? buildEmptyMatrix(kit);
  const undispatched = kit.specApproved && kit.tasks.length < kit.requirements.length;
  const status: RunResult["status"] = !kit.specApproved
    ? "needs-human"
    : drift
      ? "halted"
      : undispatched || budget.exceeded
        ? "needs-human"
        : "delivered";

  report({ kind: "info", icon: status === "delivered" ? "🏁" : "⚠", label: `Run ${status}`, status: status === "delivered" ? "ok" : "warn" });

  const storeDir = await persistRun(baseDir, runId, {
    spec: specArtifact,
    workflow: null,
    tasks: kit.tasks,
    reviews: kit.reviews,
    matrix,
    ledger: kit.ledger,
    ...(kit.verification ? { verification: kit.verification } : {}),
  });

  return {
    runId,
    status,
    spec: specArtifact,
    workflow: null,
    tasks: kit.tasks,
    reviews: kit.reviews,
    matrix,
    triage: [],
    ...(kit.verification ? { verification: kit.verification } : {}),
    drift,
    gaps,
    ledger: kit.ledger,
    savings: savingsReport(kit.ledger),
    storeDir,
  };
};

/** A trivial matrix when the run never reached the drift checkpoint (e.g. spec unapproved). */
const buildEmptyMatrix = (kit: LeaderToolkit) => ({
  rows: kit.requirements.map((r) => ({ req: r.id, implementedBy: [] as string[], reviewed: false, tested: false, verdict: "missing" as const })),
});
