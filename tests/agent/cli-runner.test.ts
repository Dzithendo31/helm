import { describe, expect, test } from "vitest";
import {
  ClaudeCliRunner,
  parseEnvelope,
  type CommandExecutor,
  type CommandResult,
} from "../../src/agent/cli-runner";
import type { AgentRequest } from "../../src/agent/runner";

const req: AgentRequest = {
  team: "Dev",
  model: "claude-haiku-4-5-20251001",
  role: "ROLE TEXT",
  mode: "produce",
  instruction: "Do the thing",
  payload: { refs: ["REQ-1"] },
};

const envelope = (overrides: Record<string, unknown> = {}): string =>
  JSON.stringify({
    type: "result",
    is_error: false,
    result: "```json\n{\"title\":\"X\"}\n```",
    total_cost_usd: 0.05,
    usage: {
      input_tokens: 10,
      cache_read_input_tokens: 5,
      cache_creation_input_tokens: 100,
      output_tokens: 20,
    },
    ...overrides,
  });

const fakeExec = (
  result: CommandResult,
  capture?: (args: readonly string[]) => void,
): CommandExecutor => {
  return async (_bin, args) => {
    capture?.(args);
    return result;
  };
};

describe("parseEnvelope", () => {
  test("sums input + cache tokens and extracts cost", () => {
    const { text, usage } = parseEnvelope(envelope());
    expect(usage.inputTokens).toBe(115); // 10 + 5 + 100
    expect(usage.outputTokens).toBe(20);
    expect(usage.costUsd).toBe(0.05);
    expect(text).toContain("title");
  });

  test("degrades gracefully on non-JSON stdout", () => {
    const { text, usage } = parseEnvelope("not json");
    expect(text).toBe("not json");
    expect(usage.inputTokens).toBe(0);
  });

  test("extracts the session id when present", () => {
    expect(parseEnvelope(envelope({ session_id: "sess-123" })).sessionId).toBe("sess-123");
    expect(parseEnvelope(envelope()).sessionId).toBeNull();
  });
});

describe("ClaudeCliRunner.buildArgs (resume)", () => {
  test("a resumed turn passes --resume and omits --system-prompt", () => {
    const args = new ClaudeCliRunner().buildArgs(req, "sess-9");
    expect(args).toContain("--resume");
    expect(args[args.indexOf("--resume") + 1]).toBe("sess-9");
    expect(args).not.toContain("--system-prompt");
  });
});

describe("ClaudeCliRunner.openSession", () => {
  test("seeds the system prompt on turn 1, then resumes by id on later turns", async () => {
    const calls: string[][] = [];
    const runner = new ClaudeCliRunner({
      exec: async (_bin, args) => {
        calls.push([...args]);
        return { stdout: envelope({ session_id: "sess-abc" }), stderr: "", code: 0 };
      },
    });
    const session = runner.openSession({ team: "Helm-Leader", model: "m", role: "LEADER ROLE" });

    await session.send({ mode: "spec", instruction: "write spec" });
    expect(session.id).toBe("sess-abc");
    expect(calls[0]).toContain("--system-prompt");
    expect(calls[0]).not.toContain("--resume");

    await session.send({ mode: "workflow", instruction: "design workflow" });
    expect(calls[1]).toContain("--resume");
    expect(calls[1][calls[1].indexOf("--resume") + 1]).toBe("sess-abc");
    expect(calls[1]).not.toContain("--system-prompt");

    session.close();
    await expect(session.send({ mode: "steer", instruction: "x" })).rejects.toThrow(/closed/);
  });
});

describe("ClaudeCliRunner", () => {
  test("builds the expected claude args", () => {
    const runner = new ClaudeCliRunner();
    const args = runner.buildArgs(req);
    expect(args[0]).toBe("-p");
    expect(args).toContain("--output-format");
    expect(args).toContain("json");
    expect(args).toContain("--model");
    expect(args).toContain("claude-haiku-4-5-20251001");
    expect(args).toContain("--system-prompt");
    expect(args).toContain("ROLE TEXT");
  });

  test("disables all tools by default (reasoning-only, single turn)", () => {
    const args = new ClaudeCliRunner().buildArgs(req);
    const i = args.indexOf("--tools");
    expect(i).toBeGreaterThan(-1);
    expect(args[i + 1]).toBe(""); // empty list = no tools
  });

  test("enables the given tools and permission mode when requested", () => {
    const runner = new ClaudeCliRunner({
      bare: true,
      allowedTools: ["Edit", "Write", "Bash"],
      permissionMode: "acceptEdits",
    });
    const args = runner.buildArgs(req);
    expect(args).toContain("--bare");
    expect(args).toContain("--tools");
    expect(args).toContain("Edit");
    expect(args).toContain("Bash");
    expect(args).toContain("--permission-mode");
    expect(args).toContain("acceptEdits");
  });

  test("parses the result JSON and usage from a successful run", async () => {
    let seen: readonly string[] = [];
    const runner = new ClaudeCliRunner({
      exec: fakeExec({ stdout: envelope(), stderr: "", code: 0 }, (a) => (seen = a)),
    });
    const res = await runner.run<{ title: string }>(req);
    expect(res.data).toEqual({ title: "X" });
    expect(res.usage.inputTokens).toBe(115);
    expect(seen).toContain("--system-prompt");
  });

  test("throws on a non-zero exit code, surfacing stderr", async () => {
    const runner = new ClaudeCliRunner({
      exec: fakeExec({ stdout: "", stderr: "auth failed", code: 1 }),
    });
    await expect(runner.run(req)).rejects.toThrow(/auth failed/);
  });
});
