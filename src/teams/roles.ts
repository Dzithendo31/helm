import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { TeamName, Teams } from "./types";

/** Roles live as editable markdown — change behavior without recompiling. */
const ROLE_FILES: Record<TeamName, string> = {
  "Helm-Leader": "helm-leader.md",
  Research: "research.md",
  Dev: "dev.md",
  Quality: "quality.md",
  Watchmen: "watchmen.md",
};

/**
 * Override each team's role with the contents of `<dir>/<team>.md` when present.
 * Returns a new Teams object; missing files leave the built-in role intact.
 */
export const applyRolesFromDir = (teams: Teams, dir: string): Teams => {
  const next: Teams = { ...teams };
  for (const name of Object.keys(ROLE_FILES) as TeamName[]) {
    const path = join(dir, ROLE_FILES[name]);
    if (!existsSync(path)) continue;
    const role = readFileSync(path, "utf8").trim();
    if (role) next[name] = { ...next[name], role };
  }
  return next;
};
