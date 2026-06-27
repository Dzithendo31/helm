import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { MockAgentRunner } from "../../src/agent/mock-runner";
import { TranscriptRunner } from "../../src/agent/transcript";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "helm-transcript-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("TranscriptRunner", () => {
  test("tees a worker call's prompt and response to transcript.md", async () => {
    const runner = new TranscriptRunner(new MockAgentRunner(), dir);
    await runner.run({
      team: "Dev",
      model: "m",
      role: "ROLE",
      mode: "produce",
      instruction: "Implement REQ-1",
      payload: { refs: ["REQ-1"] },
    });
    const md = await readFile(join(dir, "transcript.md"), "utf8");
    expect(md).toContain("Dev · produce");
    expect(md).toContain("Implement REQ-1");
    expect(md).toContain("### ← response");
    // a worker call does not go to the leader transcript
    expect(existsSync(join(dir, "leader.transcript.md"))).toBe(false);
  });

  test("session turns are recorded to both transcript.md and leader.transcript.md", async () => {
    const runner = new TranscriptRunner(new MockAgentRunner(), dir);
    const session = runner.openSession({ team: "Helm-Leader", model: "m", role: "LEADER" });
    await session.send({ mode: "spec", instruction: "write the spec" });
    await session.send({ mode: "workflow", instruction: "design the workflow" });
    session.close();

    const leader = await readFile(join(dir, "leader.transcript.md"), "utf8");
    expect(leader).toContain("Helm-Leader · spec");
    expect(leader).toContain("Helm-Leader · workflow");
    const all = await readFile(join(dir, "transcript.md"), "utf8");
    expect(all).toContain("write the spec");
    expect(all).toContain("design the workflow");
  });
});
