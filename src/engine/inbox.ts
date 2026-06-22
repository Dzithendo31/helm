/**
 * A mid-run message channel from the human to the orchestrator. The CLI fills it
 * from stdin while a run is in progress; the orchestrator drains it at safe points
 * (between dependency waves) and lets the Helm-Leader respond and steer.
 */
export interface Inbox {
  /** Return and clear all pending messages. */
  drain(): string[];
}

export class QueueInbox implements Inbox {
  private queue: string[] = [];

  push(message: string): void {
    const trimmed = message.trim();
    if (trimmed) this.queue.push(trimmed);
  }

  drain(): string[] {
    const out = this.queue;
    this.queue = [];
    return out;
  }
}

export const noopInbox: Inbox = { drain: () => [] };
