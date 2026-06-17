import { describe, expect, test } from "vitest";
import { createArtifact } from "../../src/core/artifact";
import { InvalidTransitionError, canTransition, isTerminal, transition } from "../../src/core/lifecycle";

const draft = () =>
  createArtifact({ type: "Task", body: {}, provenance: { team: "Dev", agent: "p", reason: "x" } });

describe("lifecycle", () => {
  test("permits valid transitions", () => {
    expect(canTransition("Draft", "InternalReview")).toBe(true);
    expect(canTransition("InternalReview", "TeamApproved")).toBe(true);
    expect(canTransition("TeamApproved", "Accepted")).toBe(true);
  });

  test("rejects invalid transitions", () => {
    expect(canTransition("Draft", "Accepted")).toBe(false);
    expect(() => transition(draft(), "Accepted", { team: "Dev", agent: "p", reason: "x" })).toThrow(
      InvalidTransitionError,
    );
  });

  test("Accepted and Blocked are terminal", () => {
    expect(isTerminal("Accepted")).toBe(true);
    expect(isTerminal("Blocked")).toBe(true);
    expect(isTerminal("Draft")).toBe(false);
  });

  test("transition advances state and provenance", () => {
    const moved = transition(draft(), "InternalReview", { team: "Dev", agent: "p", reason: "go" });
    expect(moved.state).toBe("InternalReview");
    expect(moved.provenance).toHaveLength(2);
  });
});
