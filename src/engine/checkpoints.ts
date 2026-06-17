import { createInterface } from "node:readline/promises";
import type { Finding } from "../core/review";
import type { SpecBody } from "../core/spec";
import { renderSpecMarkdown } from "../core/spec";

export interface SpecDecision {
  readonly approved: boolean;
  readonly feedback?: string;
}

/**
 * REQ-3 / REQ-12: the human-in-the-loop boundary. Spec approval is mandatory in
 * every mode; other checkpoints differ by mode.
 */
export interface HumanInterface {
  approveSpec(spec: SpecBody): Promise<SpecDecision>;
  answer(question: Finding): Promise<string>;
  /** The must-ask floor: credentials / irreversible product decisions. */
  mustAsk(prompt: string): Promise<string>;
  close(): void;
}

/** Console (TTY) human — used for interactive mode. */
export class ConsoleHuman implements HumanInterface {
  private readonly rl = createInterface({ input: process.stdin, output: process.stdout });

  async approveSpec(spec: SpecBody): Promise<SpecDecision> {
    process.stdout.write(`\n${renderSpecMarkdown(spec)}\n`);
    const answer = (await this.rl.question("Approve this Spec? [y/N or feedback] ")).trim();
    if (answer.toLowerCase() === "y" || answer.toLowerCase() === "yes") {
      return { approved: true };
    }
    if (answer === "" || answer.toLowerCase() === "n" || answer.toLowerCase() === "no") {
      return { approved: false };
    }
    return { approved: false, feedback: answer };
  }

  async answer(question: Finding): Promise<string> {
    return (await this.rl.question(`Question on ${question.ref}: ${question.message}\n> `)).trim();
  }

  async mustAsk(prompt: string): Promise<string> {
    return (await this.rl.question(`${prompt}\n> `)).trim();
  }

  close(): void {
    this.rl.close();
  }
}

/**
 * Autonomous human — auto-resolves questions, but still defers to a real human
 * for the two things autonomy must not decide: Spec approval and the must-ask floor.
 */
export class AutonomousHuman implements HumanInterface {
  constructor(private readonly delegate: HumanInterface) {}

  approveSpec(spec: SpecBody): Promise<SpecDecision> {
    return this.delegate.approveSpec(spec);
  }

  async answer(_question: Finding): Promise<string> {
    return "(autonomous) proceed with best judgment.";
  }

  mustAsk(prompt: string): Promise<string> {
    return this.delegate.mustAsk(prompt);
  }

  close(): void {
    this.delegate.close();
  }
}

/** Non-interactive human for offline demos and tests — auto-approves everything. */
export class AutoApproveHuman implements HumanInterface {
  async approveSpec(): Promise<SpecDecision> {
    return { approved: true };
  }

  async answer(): Promise<string> {
    return "(auto) proceed.";
  }

  async mustAsk(): Promise<string> {
    return "(auto) proceed.";
  }

  close(): void {
    /* no-op */
  }
}
