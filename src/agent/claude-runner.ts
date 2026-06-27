import type {
  AgentRequest,
  AgentResponse,
  AgentSession,
  AgentTurn,
  AgentUsage,
  SessionOptions,
  StatefulAgentRunner,
} from "./runner";
import { buildAgentPrompt, parseJsonLoose } from "./prompt";

/**
 * Adapter onto the Claude Agent SDK (in-process alternative to the CLI runner).
 *
 * NOTE: the SDK's exact `query()` message shapes should be verified against the
 * installed `@anthropic-ai/claude-agent-sdk` version. The accumulation below is
 * written defensively so a shape change degrades to empty text rather than throwing.
 */

interface QueryOutcome<T> {
  readonly text: string;
  readonly data: T;
  readonly usage: AgentUsage;
  readonly sessionId: string | null;
}

/** Drive one `query()` to completion, accumulating text, usage, and the session id. */
const drainQuery = async <T>(
  prompt: string,
  options: Record<string, unknown>,
): Promise<QueryOutcome<T>> => {
  const { query } = await import("@anthropic-ai/claude-agent-sdk");
  let text = "";
  let usage: AgentUsage = { inputTokens: 0, outputTokens: 0 };
  let sessionId: string | null = null;

  const stream = query({ prompt, options }) as AsyncIterable<Record<string, unknown>>;
  for await (const message of stream) {
    const sid = (message as { session_id?: unknown }).session_id;
    if (typeof sid === "string") sessionId = sid;
    if (message.type === "assistant") {
      const content = (message as { message?: { content?: unknown } }).message?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block && typeof block === "object" && (block as { type?: string }).type === "text") {
            text += String((block as { text?: unknown }).text ?? "");
          }
        }
      }
    }
    if (message.type === "result") {
      const u = (message as { usage?: { input_tokens?: number; output_tokens?: number } }).usage;
      if (u) usage = { inputTokens: u.input_tokens ?? 0, outputTokens: u.output_tokens ?? 0 };
    }
  }

  return { text, data: parseJsonLoose<T>(text), usage, sessionId };
};

export class ClaudeAgentRunner implements StatefulAgentRunner {
  async run<T>(req: AgentRequest): Promise<AgentResponse<T>> {
    const { text, data, usage } = await drainQuery<T>(buildAgentPrompt(req), {
      model: req.model,
      systemPrompt: req.role,
      maxTurns: 1,
      ...(req.cwd ? { cwd: req.cwd } : {}),
    });
    return { text, data, usage };
  }

  /**
   * A persistent Leader context. Each turn resumes the prior session by id (stable
   * `query()` option), so the context lives in one place without a long-lived stream.
   */
  openSession(opts: SessionOptions): AgentSession {
    let sessionId: string | null = null;
    let closed = false;
    return {
      get id() {
        return sessionId;
      },
      async send<T>(turn: AgentTurn): Promise<AgentResponse<T>> {
        if (closed) throw new Error("session is closed");
        const req: AgentRequest = {
          team: opts.team,
          model: opts.model,
          role: opts.role,
          mode: turn.mode,
          instruction: turn.instruction,
          ...(turn.payload !== undefined ? { payload: turn.payload } : {}),
          ...(turn.tools ?? opts.tools ? { tools: turn.tools ?? opts.tools } : {}),
          ...(turn.cwd ?? opts.cwd ? { cwd: turn.cwd ?? opts.cwd } : {}),
        };
        const options: Record<string, unknown> = {
          model: opts.model,
          maxTurns: 1,
          ...(turn.cwd ?? opts.cwd ? { cwd: turn.cwd ?? opts.cwd } : {}),
        };
        // First turn seeds the system prompt; later turns resume the established context.
        if (sessionId) options.resume = sessionId;
        else options.systemPrompt = opts.role;
        const res = await drainQuery<T>(buildAgentPrompt(req), options);
        if (res.sessionId) sessionId = res.sessionId;
        return { text: res.text, data: res.data, usage: res.usage };
      },
      close() {
        closed = true;
      },
    };
  }
}
