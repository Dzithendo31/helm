import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { MockAgentRunner } from "../../src/agent/mock-runner";
import type { AgentRequest, AgentResponse, AgentRunner } from "../../src/agent/runner";
import { defaultConfig } from "../../src/config";
import { AutoApproveHuman, type HumanInterface, type SpecDecision } from "../../src/engine/checkpoints";
import { QueueInbox } from "../../src/engine/inbox";
import { runHelm } from "../../src/engine/orchestrator";
import { buildTeams } from "../../src/teams/definitions";

const teams = buildTeams();
let baseDir: string;

beforeEach(async () => {
  baseDir = await mkdtemp(join(tmpdir(), "helm-test-"));
});
afterEach(async () => {
  await rm(baseDir, { recursive: true, force: true });
});

class RejectHuman implements HumanInterface {
  async approveSpec(): Promise<SpecDecision> {
    return { approved: false };
  }
  async answer(): Promise<string> {
    return "";
  }
  async mustAsk(): Promise<string> {
    return "";
  }
  close(): void {}
}

describe("orchestrator", () => {
  test("clean run delivers, all requirements covered, no drift", async () => {
    const result = await runHelm({
      request: "build a thing",
      config: defaultConfig(),
      runner: new MockAgentRunner(),
      human: new AutoApproveHuman(),
      teams,
      baseDir,
    });

    expect(result.status).toBe("delivered");
    expect(result.spec.state).toBe("Accepted");
    expect(result.tasks).toHaveLength(2);
    expect(result.drift).toBe(false);
    expect(result.tasks.every((t) => t.state === "TeamApproved")).toBe(true);
  });

  test("spec rejection halts before any work as needs-human", async () => {
    const result = await runHelm({
      request: "build a thing",
      config: defaultConfig(),
      runner: new MockAgentRunner(),
      human: new RejectHuman(),
      teams,
      baseDir,
    });

    expect(result.status).toBe("needs-human");
    expect(result.spec.state).toBe("Blocked");
    expect(result.tasks).toHaveLength(0);
  });

  test("records triage decisions; high-risk/low-confidence is researched and confidence raised", async () => {
    const result = await runHelm({
      request: "build a risky thing",
      config: { ...defaultConfig(), teamMode: false },
      runner: new MockAgentRunner({
        requirements: [
          { statement: "Risky novel bit", risk: "high", confidence: "low" },
          { statement: "Trivial bit", risk: "low", confidence: "high" },
        ],
      }),
      human: new AutoApproveHuman(),
      teams,
      baseDir,
    });

    expect(result.triage).toHaveLength(2);
    const risky = result.triage.find((t) => t.req === "REQ-1");
    const trivial = result.triage.find((t) => t.req === "REQ-2");
    expect(risky?.rigor).toBe("research-then-review");
    expect(risky?.researched).toBe(true);
    expect(risky?.confidence).toBe("medium"); // raised from low by research
    expect(trivial?.rigor).toBe("skip");
    expect(trivial?.researched).toBe(false);
  });

  test("team-mode off records optimise-mode savings for skipped QA", async () => {
    const result = await runHelm({
      request: "build a thing",
      config: { ...defaultConfig(), teamMode: false },
      runner: new MockAgentRunner(),
      human: new AutoApproveHuman(),
      teams,
      baseDir,
    });

    expect(result.status).toBe("delivered");
    expect(result.savings.potentialTokens).toBeGreaterThan(0);
    expect(result.savings.reasons.some((r) => r.includes("team-mode off"))).toBe(true);
  });

  test("Watchmen halt the run when they judge a requirement unsatisfied", async () => {
    const result = await runHelm({
      request: "build a thing",
      config: defaultConfig(),
      runner: new MockAgentRunner({
        requirements: [{ statement: "Must validate input" }],
        drift: { requirements: [{ id: "REQ-1", satisfied: false, reason: "no validation present" }] },
      }),
      human: new AutoApproveHuman(),
      teams,
      baseDir,
    });

    expect(result.drift).toBe(true);
    expect(result.status).toBe("halted");
  });

  test("Watchmen halt on over-production (extraneous scope creep)", async () => {
    const result = await runHelm({
      request: "build a thing",
      config: defaultConfig(),
      runner: new MockAgentRunner({
        requirements: [{ statement: "Reverse a string" }],
        drift: { extraneous: [{ what: "jest.config.js", reason: "no requirement asked for a test harness" }] },
      }),
      human: new AutoApproveHuman(),
      teams,
      baseDir,
    });

    expect(result.drift).toBe(true);
    expect(result.status).toBe("halted");
  });

  test("untested work surfaces as a coverage gap, not a drift halt", async () => {
    const result = await runHelm({
      request: "build a thing",
      config: defaultConfig(),
      runner: new MockAgentRunner({ tested: false }),
      human: new AutoApproveHuman(),
      teams,
      baseDir,
    });

    expect(result.gaps).toBe(true);
    expect(result.drift).toBe(false);
    expect(result.status).toBe("delivered");
  });

  test("fails loud (needs-human + error) when the spec parses to no requirements", async () => {
    const result = await runHelm({
      request: "build a thing",
      config: defaultConfig(),
      runner: new MockAgentRunner({ requirements: [] }), // empty → unparseable spec
      human: new AutoApproveHuman(),
      teams,
      baseDir,
    });

    expect(result.status).toBe("needs-human");
    expect(result.spec.state).toBe("Blocked");
    expect(result.error).toMatch(/did not parse/i);
    expect(result.tasks).toHaveLength(0);
  });

  test("tolerates real-model field aliases (title / acceptance_criteria)", async () => {
    // A runner that returns the alias-shaped spec a real model actually emits.
    class AliasSpecRunner implements AgentRunner {
      private readonly base = new MockAgentRunner();
      async run<T>(req: AgentRequest): Promise<AgentResponse<T>> {
        if (req.mode === "spec") {
          const data = {
            title: "Reverse",
            requirements: [
              { title: "Reverse a string", acceptance_criteria: ["handles unicode"], risk: "low", confidence: "high" },
            ],
          };
          return { text: JSON.stringify(data), data: data as T, usage: { inputTokens: 1, outputTokens: 1 } };
        }
        return this.base.run<T>(req);
      }
    }

    const result = await runHelm({
      request: "reverse a string",
      config: defaultConfig(),
      runner: new AliasSpecRunner(),
      human: new AutoApproveHuman(),
      teams,
      baseDir,
    });

    expect(result.status).toBe("delivered");
    expect(result.spec.body.requirements).toHaveLength(1);
    expect(result.spec.body.requirements[0]?.statement).toBe("Reverse a string");
    expect(result.spec.body.requirements[0]?.acceptance).toEqual(["handles unicode"]);
  });

  // A runner that tracks how many Dev calls are in flight at once.
  class ConcurrencyRunner implements AgentRunner {
    private readonly base: MockAgentRunner;
    active = 0;
    maxActive = 0;
    constructor(options: ConstructorParameters<typeof MockAgentRunner>[0]) {
      this.base = new MockAgentRunner(options);
    }
    async run<T>(req: AgentRequest): Promise<AgentResponse<T>> {
      if (req.mode === "produce" && req.team === "Dev") {
        this.active += 1;
        this.maxActive = Math.max(this.maxActive, this.active);
        await new Promise((r) => setTimeout(r, 5));
        this.active -= 1;
      }
      return this.base.run<T>(req);
    }
  }

  test("runs independent requirements in parallel (reasoning mode)", async () => {
    const runner = new ConcurrencyRunner({
      requirements: [{ statement: "A" }, { statement: "B" }, { statement: "C" }],
    });
    const result = await runHelm({
      request: "x",
      config: { ...defaultConfig(), teamMode: false },
      runner,
      human: new AutoApproveHuman(),
      teams,
      baseDir,
    });

    expect(result.status).toBe("delivered");
    expect(result.tasks).toHaveLength(3);
    expect(runner.maxActive).toBeGreaterThan(1); // they overlapped
  });

  test("respects workflow dependencies — a dependent requirement does not overlap its prerequisite", async () => {
    const runner = new ConcurrencyRunner({
      requirements: [{ statement: "A" }, { statement: "B" }],
      workflowExecution: [{ req: "REQ-2", dependsOn: ["REQ-1"] }],
    });
    const result = await runHelm({
      request: "x",
      config: { ...defaultConfig(), teamMode: false },
      runner,
      human: new AutoApproveHuman(),
      teams,
      baseDir,
    });

    expect(result.status).toBe("delivered");
    expect(result.tasks.map((t) => t.refs[0])).toEqual(["REQ-1", "REQ-2"]); // deterministic order preserved
    expect(runner.maxActive).toBe(1); // REQ-2 waited for REQ-1
  });

  test("a mid-run message is answered by the Leader and steers later Dev work", async () => {
    const inbox = new QueueInbox();
    inbox.push("please use strict mode");

    let devInstruction = "";
    class SteerRunner implements AgentRunner {
      private readonly base = new MockAgentRunner({
        requirements: [{ statement: "X" }],
        steer: { reply: "Will do.", guidance: "use TypeScript strict mode" },
      });
      async run<T>(req: AgentRequest): Promise<AgentResponse<T>> {
        if (req.mode === "produce" && req.team === "Dev") devInstruction = req.instruction;
        return this.base.run<T>(req);
      }
    }

    const result = await runHelm({
      request: "x",
      config: { ...defaultConfig(), teamMode: false },
      runner: new SteerRunner(),
      human: new AutoApproveHuman(),
      teams,
      baseDir,
      inbox,
    });

    expect(result.status).toBe("delivered");
    expect(devInstruction).toContain("strict mode"); // the Leader's guidance reached Dev
  });

  test("build mode gives Dev tools + workspace and captures written files", async () => {
    class CapturingRunner implements AgentRunner {
      private readonly base = new MockAgentRunner({ requirements: [{ statement: "Reverse a string" }] });
      devReq: AgentRequest | undefined;
      async run<T>(req: AgentRequest): Promise<AgentResponse<T>> {
        if (req.mode === "produce" && req.team === "Dev") {
          this.devReq = req;
          const data = { title: "t", summary: "s", files: ["src/reverse.ts"], tested: true };
          return { text: "", data: data as T, usage: { inputTokens: 1, outputTokens: 1 } };
        }
        return this.base.run<T>(req);
      }
    }

    const runner = new CapturingRunner();
    const result = await runHelm({
      request: "reverse a string",
      config: { ...defaultConfig(), teamMode: false },
      runner,
      human: new AutoApproveHuman(),
      teams,
      baseDir,
      devWritesFiles: true,
      workspace: "/tmp/helm-ws",
    });

    expect(runner.devReq?.tools).toEqual(["Read", "Write", "Edit", "Bash"]);
    expect(runner.devReq?.cwd).toBe("/tmp/helm-ws");
    // Dev claimed src/reverse.ts but wrote nothing → reconciliation records reality (none).
    expect(result.tasks[0]?.body.files).toEqual([]);
  });

  test("reconciles Dev's claimed files against what actually landed on disk", async () => {
    // Dev claims a file it didn't write, and writes a different one for real.
    class WritingRunner implements AgentRunner {
      private readonly base = new MockAgentRunner({ requirements: [{ statement: "X" }] });
      async run<T>(req: AgentRequest): Promise<AgentResponse<T>> {
        if (req.mode === "produce" && req.team === "Dev") {
          await writeFile(join(baseDir, "actual.ts"), "export const x = 1;", "utf8");
          const data = { title: "t", summary: "s", files: ["claimed-but-missing.ts"], tested: true };
          return { text: "", data: data as T, usage: { inputTokens: 1, outputTokens: 1 } };
        }
        return this.base.run<T>(req);
      }
    }

    const result = await runHelm({
      request: "x",
      config: { ...defaultConfig(), teamMode: false },
      runner: new WritingRunner(),
      human: new AutoApproveHuman(),
      teams,
      baseDir,
      devWritesFiles: true,
      workspace: baseDir,
    });

    // The fictional claim is dropped; the real file is recorded.
    expect(result.tasks[0]?.body.files).toContain("actual.ts");
    expect(result.tasks[0]?.body.files).not.toContain("claimed-but-missing.ts");
  });

  test("reasoning-only runs never report files, even if Dev claims some", async () => {
    class ClaimingRunner implements AgentRunner {
      private readonly base = new MockAgentRunner({ requirements: [{ statement: "X" }] });
      async run<T>(req: AgentRequest): Promise<AgentResponse<T>> {
        if (req.mode === "produce" && req.team === "Dev") {
          const data = { title: "t", summary: "s", files: ["phantom.ts"], tested: true };
          return { text: "", data: data as T, usage: { inputTokens: 1, outputTokens: 1 } };
        }
        return this.base.run<T>(req);
      }
    }

    const result = await runHelm({
      request: "x",
      config: { ...defaultConfig(), teamMode: false },
      runner: new ClaimingRunner(),
      human: new AutoApproveHuman(),
      teams,
      baseDir,
    });

    // Not build mode → no disk reconciliation → the phantom claim is dropped.
    expect(result.tasks[0]?.body.files).toEqual([]);
  });

  test("an agent failure degrades the requirement to needs-human without crashing the run", async () => {
    class FailingDevRunner implements AgentRunner {
      private readonly base = new MockAgentRunner({ requirements: [{ statement: "A" }, { statement: "B" }] });
      async run<T>(req: AgentRequest): Promise<AgentResponse<T>> {
        if (req.mode === "produce" && req.team === "Dev") throw new Error("claude timed out after 600000ms");
        return this.base.run<T>(req);
      }
    }

    const result = await runHelm({
      request: "build a thing",
      config: { ...defaultConfig(), teamMode: false },
      runner: new FailingDevRunner(),
      human: new AutoApproveHuman(),
      teams,
      baseDir,
    });

    expect(result.status).toBe("needs-human");
    expect(result.tasks).toHaveLength(2);
    expect(result.tasks.every((t) => t.state === "NeedsHuman")).toBe(true);
    expect(result.storeDir).toContain(".helm"); // store still written despite failures
  });

  test("persistent blockers on a high-risk requirement escalate to needs-human", async () => {
    const blocker = { kind: "Blocker" as const, ref: "REQ-1", message: "no" };
    const result = await runHelm({
      request: "build a risky thing",
      config: defaultConfig(),
      runner: new MockAgentRunner({
        requirements: [{ statement: "Risky bit", risk: "high", confidence: "low" }],
        critiqueQueue: [[blocker], [blocker], [blocker]],
      }),
      human: new AutoApproveHuman(),
      teams,
      baseDir,
    });

    expect(result.status).toBe("needs-human");
    expect(result.tasks.some((t) => t.state === "NeedsHuman")).toBe(true);
  });
});
