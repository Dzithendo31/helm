import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { UiSession } from "../../src/server/session";
import type { UiEvent } from "../../src/server/contract";

const ROLES = join(process.cwd(), "roles");
let baseDir: string;

const until = async (cond: () => boolean, ms = 8000): Promise<void> => {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error("condition timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
};

beforeEach(async () => {
  baseDir = await mkdtemp(join(tmpdir(), "helm-ui-"));
});
afterEach(async () => {
  await rm(baseDir, { recursive: true, force: true });
});

describe("UiSession", () => {
  test("starts idle with the five team nodes", () => {
    const s = new UiSession({ runnerKind: "mock", rolesDir: ROLES, baseDir });
    const state = s.snapshot();
    expect(state.status).toBe("idle");
    expect(state.teams.map((t) => t.id)).toEqual(["helm-leader", "research", "dev", "quality", "watchmen"]);
  });

  test("subscribe immediately delivers a snapshot event", () => {
    const s = new UiSession({ runnerKind: "mock", rolesDir: ROLES, baseDir });
    const events: UiEvent[] = [];
    s.subscribe((e) => events.push(e));
    expect(events[0]?.type).toBe("snapshot");
  });

  test("a mock run gates on spec approval, then delivers and emits artifacts", async () => {
    const s = new UiSession({ runnerKind: "mock", rolesDir: ROLES, baseDir });
    const events: UiEvent[] = [];
    s.subscribe((e) => events.push(e));

    const done = s.start("build a notes API", false, true);
    await until(() => s.snapshot().status === "awaiting-approval");
    expect(s.snapshot().pending?.kind).toBe("spec");

    s.command({ kind: "approveSpec" });
    await done;

    const state = s.snapshot();
    expect(state.status).toBe("delivered");
    expect(state.pending).toBeNull();
    expect(state.artifacts.some((a) => a.type === "spec")).toBe(true);
    expect(state.teams.find((t) => t.id === "dev")?.status).toBe("done");
    expect(events.some((e) => e.type === "artifact")).toBe(true);
    expect(events.some((e) => e.type === "tokens")).toBe(true);
  });

  test("rejecting the spec ends the run as needs-human", async () => {
    const s = new UiSession({ runnerKind: "mock", rolesDir: ROLES, baseDir });
    s.subscribe(() => {});
    const done = s.start("build a thing", false, true);
    await until(() => s.snapshot().status === "awaiting-approval");
    s.command({ kind: "rejectSpec" });
    await done;
    expect(s.snapshot().status).toBe("needs-human");
  });

  test("setConfig updates config and emits a config event", () => {
    const s = new UiSession({ runnerKind: "mock", rolesDir: ROLES, baseDir });
    const events: UiEvent[] = [];
    s.subscribe((e) => events.push(e));
    const r = s.command({ kind: "setConfig", teamMode: false });
    expect(r.ok).toBe(true);
    expect(s.snapshot().config.teamMode).toBe(false);
    expect(events.some((e) => e.type === "config")).toBe(true);
  });

  test("approveSpec with nothing pending is rejected", () => {
    const s = new UiSession({ runnerKind: "mock", rolesDir: ROLES, baseDir });
    expect(s.command({ kind: "approveSpec" }).ok).toBe(false);
  });
});
