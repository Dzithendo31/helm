import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { detectTestCommand, runVerification, type ShellRunner } from "../../src/engine/verify";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "helm-verify-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("detectTestCommand", () => {
  test("finds npm test from a package.json test script", async () => {
    await writeFile(join(dir, "package.json"), JSON.stringify({ scripts: { test: "vitest" } }), "utf8");
    expect(detectTestCommand(dir)).toBe("npm test --silent");
  });

  test("returns null when nothing is detected", () => {
    expect(detectTestCommand(dir)).toBeNull();
  });

  test("runs bare node:test files via the bundled tsx when there is no project config", async () => {
    await writeFile(join(dir, "reverseString.test.ts"), "import { test } from 'node:test';", "utf8");
    const cmd = detectTestCommand(dir);
    expect(cmd).not.toBeNull();
    expect(cmd).toContain("--test");
    expect(cmd).toContain("tsx");
    expect(cmd).toContain("reverseString.test.ts");
  });

  test("a real package.json test script wins over bare test files", async () => {
    await writeFile(join(dir, "package.json"), JSON.stringify({ scripts: { test: "vitest" } }), "utf8");
    await writeFile(join(dir, "x.test.ts"), "", "utf8");
    expect(detectTestCommand(dir)).toBe("npm test --silent");
  });
});

describe("runVerification", () => {
  test("a passing command (exit 0) → ran + passed", async () => {
    const exec: ShellRunner = async () => ({ exitCode: 0, output: "2 passed" });
    const result = await runVerification({ workspace: dir, command: "npm test", exec });
    expect(result).toMatchObject({ ran: true, passed: true, exitCode: 0 });
  });

  test("a failing command (exit 1) → ran but not passed", async () => {
    const exec: ShellRunner = async () => ({ exitCode: 1, output: "1 failed" });
    const result = await runVerification({ workspace: dir, command: "npm test", exec });
    expect(result).toMatchObject({ ran: true, passed: false, exitCode: 1 });
    expect(result.output).toContain("failed");
  });

  test("no command and nothing detected → did not run", async () => {
    const result = await runVerification({ workspace: dir, command: null });
    expect(result.ran).toBe(false);
    expect(result.passed).toBe(false);
  });
});
