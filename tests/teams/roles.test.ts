import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { buildTeams } from "../../src/teams/definitions";
import { applyRolesFromDir } from "../../src/teams/roles";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "helm-roles-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("applyRolesFromDir", () => {
  test("overrides a team's role from markdown, leaving others intact", async () => {
    await writeFile(join(dir, "dev.md"), "Custom Dev charter.", "utf8");
    const base = buildTeams();
    const teams = applyRolesFromDir(base, dir);

    expect(teams.Dev.role).toBe("Custom Dev charter.");
    expect(teams.Quality.role).toBe(base.Quality.role); // untouched
    expect(base.Dev.role).not.toBe("Custom Dev charter."); // original not mutated
  });

  test("missing directory leaves all roles at their built-in defaults", () => {
    const base = buildTeams();
    const teams = applyRolesFromDir(base, join(dir, "does-not-exist"));
    expect(teams.Dev.role).toBe(base.Dev.role);
  });
});
