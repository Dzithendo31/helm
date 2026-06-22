import { describe, expect, test } from "vitest";
import { QueueInbox } from "../../src/engine/inbox";

describe("QueueInbox", () => {
  test("drain returns queued messages and clears the queue", () => {
    const inbox = new QueueInbox();
    inbox.push("first");
    inbox.push("second");
    expect(inbox.drain()).toEqual(["first", "second"]);
    expect(inbox.drain()).toEqual([]);
  });

  test("ignores blank messages and trims", () => {
    const inbox = new QueueInbox();
    inbox.push("   ");
    inbox.push("  hello  ");
    expect(inbox.drain()).toEqual(["hello"]);
  });
});
