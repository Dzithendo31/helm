import { describe, expect, test } from "vitest";
import { createArtifact, reviseArtifact } from "../../src/core/artifact";

describe("artifact", () => {
  test("creates a v1 Draft artifact with initial provenance", () => {
    const a = createArtifact({
      type: "Task",
      body: { value: 1 },
      provenance: { team: "Dev", agent: "p", reason: "draft" },
    });
    expect(a.version).toBe(1);
    expect(a.state).toBe("Draft");
    expect(a.provenance).toHaveLength(1);
    expect(a.id.startsWith("task_")).toBe(true);
  });

  test("revise returns a new immutable version, never mutating the original", () => {
    const a = createArtifact({
      type: "Task",
      body: { value: 1 },
      provenance: { team: "Dev", agent: "p", reason: "draft" },
    });
    const b = reviseArtifact(a, { body: { value: 2 } }, { team: "Dev", agent: "p", reason: "revise" });

    expect(b.version).toBe(2);
    expect(b.body).toEqual({ value: 2 });
    expect(b.provenance).toHaveLength(2);
    // original untouched
    expect(a.version).toBe(1);
    expect(a.body).toEqual({ value: 1 });
  });
});
