import type { ExecutionEdge } from "../core/workflow";

/**
 * Group requirement ids into dependency **waves** (topological levels). Ids in the
 * same wave have no unmet dependencies and may run in parallel.
 *
 * Robust by construction: unknown deps and self-deps are ignored, and a dependency
 * cycle is broken by emitting the remaining ids as one final wave (so a bad plan
 * degrades to "run the rest together" rather than hanging).
 */
export const buildWaves = (
  reqIds: readonly string[],
  edges: readonly ExecutionEdge[],
): string[][] => {
  const ids = new Set(reqIds);
  const deps = new Map<string, Set<string>>();
  for (const id of reqIds) deps.set(id, new Set<string>());
  for (const edge of edges) {
    const set = deps.get(edge.req);
    if (!set) continue;
    for (const d of edge.dependsOn) {
      if (d !== edge.req && ids.has(d)) set.add(d);
    }
  }

  const done = new Set<string>();
  const waves: string[][] = [];
  while (done.size < reqIds.length) {
    const wave = reqIds.filter(
      (id) => !done.has(id) && [...(deps.get(id) ?? [])].every((d) => done.has(d)),
    );
    if (wave.length === 0) {
      waves.push(reqIds.filter((id) => !done.has(id))); // cycle / unresolved → final wave
      break;
    }
    for (const id of wave) done.add(id);
    waves.push(wave);
  }
  return waves;
};
