import { describe, expect, test } from "vitest";
import { createArtifact, type Artifact } from "../../src/core/artifact";
import type { Finding } from "../../src/core/review";
import type { TaskBody } from "../../src/core/task";
import { MockAgentRunner } from "../../src/agent/mock-runner";
import { emptyLedger } from "../../src/core/ledger";
import { buildTeams } from "../../src/teams/definitions";
import { runGate } from "../../src/teams/gate";

const teams = buildTeams();
const blocker: Finding = { kind: "Blocker", ref: "REQ-1", message: "fix it" };

const draftTask = (): Artifact<TaskBody> =>
  createArtifact<TaskBody>({
    type: "Task",
    body: { title: "t", summary: "s", refs: ["REQ-1"], files: [], tested: true, reviewed: false },
    refs: ["REQ-1"],
    provenance: { team: "Dev", agent: "p", reason: "draft" },
  });

describe("gate (3-cycle producer/critic loop)", () => {
  test("no critic → single self-review pass, marked reviewed", async () => {
    const result = await runGate({
      artifact: draftTask(),
      producer: teams.Dev,
      critic: null,
      runner: new MockAgentRunner(),
      ledger: emptyLedger(),
      rigor: "self-review",
    });
    expect(result.artifact.state).toBe("TeamApproved");
    expect(result.artifact.body.reviewed).toBe(true);
    expect(result.escalated).toBe(false);
  });

  test("approves immediately when critic raises no blockers", async () => {
    const result = await runGate({
      artifact: draftTask(),
      producer: teams.Dev,
      critic: teams.Quality,
      runner: new MockAgentRunner(),
      ledger: emptyLedger(),
      rigor: "team-review",
    });
    expect(result.artifact.state).toBe("TeamApproved");
    expect(result.cycles).toBe(0);
  });

  test("resolves blocker on a later cycle then approves", async () => {
    const runner = new MockAgentRunner({ critiqueQueue: [[blocker], []] });
    const result = await runGate({
      artifact: draftTask(),
      producer: teams.Dev,
      critic: teams.Quality,
      runner,
      ledger: emptyLedger(),
      rigor: "team-review",
    });
    expect(result.artifact.state).toBe("TeamApproved");
    expect(result.cycles).toBe(1);
    expect(result.escalated).toBe(false);
  });

  test("escalates to NeedsHuman when blockers persist past 3 cycles", async () => {
    const runner = new MockAgentRunner({ critiqueQueue: [[blocker], [blocker], [blocker]] });
    const result = await runGate({
      artifact: draftTask(),
      producer: teams.Dev,
      critic: teams.Quality,
      runner,
      ledger: emptyLedger(),
      rigor: "team-review",
    });
    expect(result.escalated).toBe(true);
    expect(result.artifact.state).toBe("NeedsHuman");
    expect(result.cycles).toBe(3);
  });
});
