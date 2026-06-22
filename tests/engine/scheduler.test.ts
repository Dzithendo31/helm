import { describe, expect, test } from "vitest";
import { buildWaves } from "../../src/engine/scheduler";

describe("buildWaves", () => {
  test("no dependencies → a single parallel wave", () => {
    expect(buildWaves(["REQ-1", "REQ-2", "REQ-3"], [])).toEqual([["REQ-1", "REQ-2", "REQ-3"]]);
  });

  test("a linear chain → one requirement per wave", () => {
    const waves = buildWaves(
      ["REQ-1", "REQ-2", "REQ-3"],
      [
        { req: "REQ-2", dependsOn: ["REQ-1"] },
        { req: "REQ-3", dependsOn: ["REQ-2"] },
      ],
    );
    expect(waves).toEqual([["REQ-1"], ["REQ-2"], ["REQ-3"]]);
  });

  test("diamond → parallel middle wave", () => {
    const waves = buildWaves(
      ["REQ-1", "REQ-2", "REQ-3", "REQ-4"],
      [
        { req: "REQ-2", dependsOn: ["REQ-1"] },
        { req: "REQ-3", dependsOn: ["REQ-1"] },
        { req: "REQ-4", dependsOn: ["REQ-2", "REQ-3"] },
      ],
    );
    expect(waves).toEqual([["REQ-1"], ["REQ-2", "REQ-3"], ["REQ-4"]]);
  });

  test("unknown and self dependencies are ignored", () => {
    const waves = buildWaves(
      ["REQ-1", "REQ-2"],
      [
        { req: "REQ-1", dependsOn: ["REQ-1", "REQ-99"] },
        { req: "REQ-2", dependsOn: ["REQ-1"] },
      ],
    );
    expect(waves).toEqual([["REQ-1"], ["REQ-2"]]);
  });

  test("a dependency cycle degrades to a final wave instead of hanging", () => {
    const waves = buildWaves(
      ["REQ-1", "REQ-2"],
      [
        { req: "REQ-1", dependsOn: ["REQ-2"] },
        { req: "REQ-2", dependsOn: ["REQ-1"] },
      ],
    );
    expect(waves).toEqual([["REQ-1", "REQ-2"]]);
  });
});
