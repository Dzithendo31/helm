import type { Finding, ReviewBody } from "../core/review";
import type { RequirementId } from "../core/spec";
import type { TaskBody } from "../core/task";
import type { AgentRequest, AgentResponse, AgentRunner, AgentUsage } from "./runner";

export interface MockRequirementSeed {
  readonly statement: string;
  readonly acceptance?: readonly string[];
  readonly risk?: "low" | "medium" | "high";
  readonly confidence?: "low" | "medium" | "high";
}

export interface MockOptions {
  /** Requirements the Leader "writes" in spec mode. */
  readonly requirements?: readonly MockRequirementSeed[];
  readonly workflowSteps?: readonly string[];
  readonly workflowExecution?: readonly { readonly req: string; readonly dependsOn: readonly string[] }[];
  /** Each critique call shifts one set of findings; empty/exhausted => no blockers. */
  readonly critiqueQueue?: readonly (readonly Finding[])[];
  /** Attestation the Dev team records on produced tasks. */
  readonly tested?: boolean;
  /** Leader's reply to a mid-run human message (steer mode). */
  readonly steer?: { readonly reply: string; readonly guidance: string };
  /** Watchmen semantic verdict returned in drift mode (default: clean). */
  readonly drift?: {
    readonly requirements?: ReadonlyArray<{ id: string; satisfied: boolean; reason?: string }>;
    readonly extraneous?: ReadonlyArray<{ what: string; reason?: string }>;
  };
  readonly usage?: AgentUsage;
}

const DEFAULT_USAGE: AgentUsage = { inputTokens: 100, outputTokens: 200 };

const asRefs = (payload: unknown): RequirementId[] => {
  if (payload && typeof payload === "object" && "refs" in payload) {
    const refs = (payload as { refs?: unknown }).refs;
    if (Array.isArray(refs)) return refs.filter((r): r is string => typeof r === "string");
  }
  return [];
};

const asTarget = (payload: unknown): string => {
  if (payload && typeof payload === "object" && "target" in payload) {
    const t = (payload as { target?: unknown }).target;
    if (typeof t === "string") return t;
  }
  return "unknown";
};

/**
 * Deterministic, offline runner. A default instance produces a clean,
 * fully-covered, no-drift run. Tests drive edge cases (blocker loops,
 * missing/extraneous tasks) via the options.
 */
export class MockAgentRunner implements AgentRunner {
  private readonly options: MockOptions;
  private critiqueIndex = 0;

  constructor(options: MockOptions = {}) {
    this.options = options;
  }

  async run<T>(req: AgentRequest): Promise<AgentResponse<T>> {
    const usage = this.options.usage ?? DEFAULT_USAGE;
    const data = this.dataFor(req);
    return { text: JSON.stringify(data), data: data as T, usage };
  }

  private dataFor(req: AgentRequest): unknown {
    switch (req.mode) {
      case "spec":
        return {
          title: "Generated Spec",
          requirements:
            this.options.requirements ??
            ([
              { statement: "The primary capability works end to end." },
              { statement: "Errors are handled and surfaced clearly." },
            ] satisfies MockRequirementSeed[]),
        };
      case "workflow":
        return {
          steps: this.options.workflowSteps ?? ["research", "dev", "quality", "watchmen"],
          rationale: "Sized to the request.",
          ...(this.options.workflowExecution ? { execution: this.options.workflowExecution } : {}),
        };
      case "produce": {
        const refs = asRefs(req.payload);
        return {
          title: `Work for ${refs.join(", ") || "request"}`,
          summary: "Implemented per the requirement.",
          refs,
          files: [],
          tested: this.options.tested ?? true,
          reviewed: false,
        } satisfies TaskBody;
      }
      case "critique": {
        const queue = this.options.critiqueQueue ?? [];
        const findings = queue[this.critiqueIndex] ?? [];
        this.critiqueIndex += 1;
        return { target: asTarget(req.payload), findings } satisfies ReviewBody;
      }
      case "drift":
        return this.options.drift ?? { requirements: [], extraneous: [] };
      case "steer":
        return this.options.steer ?? { reply: "Acknowledged.", guidance: "" };
    }
  }
}
