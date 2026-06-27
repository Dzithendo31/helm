import { describe, expect, test } from "vitest";
import { MockAgentRunner } from "../../src/agent/mock-runner";
import { AutoApproveHuman, type HumanInterface, type SpecDecision } from "../../src/engine/checkpoints";
import { Budget } from "../../src/engine/budget";
import { LeaderToolkit, type ToolkitDeps } from "../../src/engine/leader-toolkit";
import { buildTeams } from "../../src/teams/definitions";

const deps = (over: Partial<ToolkitDeps> = {}): ToolkitDeps => ({
  runner: new MockAgentRunner(),
  teams: buildTeams(),
  human: new AutoApproveHuman(),
  budget: new Budget(),
  request: "build a thing",
  ...over,
});

class RejectHuman implements HumanInterface {
  async approveSpec(): Promise<SpecDecision> {
    return { approved: false, feedback: "too vague" };
  }
  async answer(): Promise<string> {
    return "";
  }
  async mustAsk(): Promise<string> {
    return "";
  }
  close(): void {}
}

describe("LeaderToolkit", () => {
  test("set_spec records requirements and marks approved when the human approves", async () => {
    const kit = new LeaderToolkit(deps());
    const res = await kit.setSpec({ title: "T", requirements: [{ statement: "It works." }, { statement: "It is safe." }] });
    expect(res.approved).toBe(true);
    expect(kit.specApproved).toBe(true);
    expect(kit.requirements.map((r) => r.id)).toEqual(["REQ-1", "REQ-2"]);
  });

  test("set_spec surfaces rejection feedback and does not approve", async () => {
    const kit = new LeaderToolkit(deps({ human: new RejectHuman() }));
    const res = await kit.setSpec({ requirements: [{ statement: "x" }] });
    expect(res).toEqual({ approved: false, feedback: "too vague" });
    expect(kit.specApproved).toBe(false);
  });

  test("dispatch_dev refuses before the spec is approved", async () => {
    const kit = new LeaderToolkit(deps());
    const res = await kit.dispatchDev({ reqId: "REQ-1", statement: "do it" });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/not approved/);
  });

  test("dispatch_dev produces a task and charges the budget once approved", async () => {
    const budget = new Budget();
    const kit = new LeaderToolkit(deps({ budget }));
    await kit.setSpec({ requirements: [{ statement: "do it" }] });
    const res = await kit.dispatchDev({ reqId: "REQ-1", statement: "do it" });
    expect(res.ok).toBe(true);
    expect(kit.tasks).toHaveLength(1);
    expect(budget.spentTokens).toBeGreaterThan(0);
    expect(budget.toolCalls).toBe(1);
  });

  test("dispatch_dev refuses once the budget is spent", async () => {
    const budget = new Budget({ maxTokens: 1, maxToolCalls: 100 });
    const kit = new LeaderToolkit(deps({ budget }));
    await kit.setSpec({ requirements: [{ statement: "do it" }] });
    budget.charge({ inputTokens: 5, outputTokens: 0 }); // blow the ceiling
    const res = await kit.dispatchDev({ reqId: "REQ-1", statement: "do it" });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/budget/);
  });

  test("finalize runs the drift checkpoint and builds the matrix", async () => {
    const kit = new LeaderToolkit(deps());
    await kit.setSpec({ requirements: [{ statement: "do it" }] });
    await kit.dispatchDev({ reqId: "REQ-1", statement: "do it" });
    const { drift } = await kit.finalize();
    expect(kit.driftChecked).toBe(true);
    expect(kit.matrix).not.toBeNull();
    expect(drift).toBe(false);
  });
});
