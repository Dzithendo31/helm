import type { AgentUsage } from "../agent/runner";

/**
 * The run budget — the fence around an agent that can call tools in a loop. A run
 * may not exceed a token ceiling or a tool-call ceiling; once either is crossed the
 * supervisor stops handing out new work and escalates to a human (design R1/R4/R5).
 */
export interface BudgetLimits {
  readonly maxTokens: number;
  readonly maxToolCalls: number;
}

/** Generous defaults: enough for a real multi-requirement build, far below "runaway". */
export const DEFAULT_BUDGET: BudgetLimits = {
  maxTokens: 2_000_000,
  maxToolCalls: 40,
};

export class Budget {
  private tokens = 0;
  private calls = 0;

  constructor(private readonly limits: BudgetLimits = DEFAULT_BUDGET) {}

  /** Tokens consumed so far (input + output across all charged calls). */
  get spentTokens(): number {
    return this.tokens;
  }

  get toolCalls(): number {
    return this.calls;
  }

  get limit(): BudgetLimits {
    return this.limits;
  }

  /** Record the token cost of a model call. */
  charge(usage: AgentUsage): void {
    this.tokens += usage.inputTokens + usage.outputTokens;
  }

  /** Count one unit of delegated work (a tool call / team dispatch). */
  countCall(): void {
    this.calls += 1;
  }

  get exceeded(): boolean {
    return this.tokens >= this.limits.maxTokens || this.calls >= this.limits.maxToolCalls;
  }

  /** Whether more delegated work may be started right now. */
  get canSpend(): boolean {
    return !this.exceeded;
  }

  get remainingTokens(): number {
    return Math.max(0, this.limits.maxTokens - this.tokens);
  }

  /** One-line reason, for escalation messages. */
  get reason(): string {
    if (this.calls >= this.limits.maxToolCalls) {
      return `tool-call budget reached (${this.calls}/${this.limits.maxToolCalls})`;
    }
    return `token budget reached (${this.tokens}/${this.limits.maxTokens})`;
  }
}
