import type { AgentRequest, AgentResponse, AgentRunner, AgentUsage } from "./runner";
import { buildAgentPrompt, parseJsonLoose } from "./prompt";

/**
 * Adapter onto the Claude Agent SDK (in-process alternative to the CLI runner).
 *
 * NOTE: the SDK's exact `query()` message shapes should be verified against the
 * installed `@anthropic-ai/claude-agent-sdk` version. The accumulation below is
 * written defensively so a shape change degrades to empty text rather than throwing.
 */
export class ClaudeAgentRunner implements AgentRunner {
  async run<T>(req: AgentRequest): Promise<AgentResponse<T>> {
    // Imported lazily so offline runs (MockAgentRunner) never load the SDK.
    const { query } = await import("@anthropic-ai/claude-agent-sdk");

    let text = "";
    let usage: AgentUsage = { inputTokens: 0, outputTokens: 0 };

    const stream = query({
      prompt: buildAgentPrompt(req),
      options: {
        model: req.model,
        systemPrompt: req.role,
        maxTurns: 1,
      },
    });

    for await (const message of stream as AsyncIterable<Record<string, unknown>>) {
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
        if (u) {
          usage = { inputTokens: u.input_tokens ?? 0, outputTokens: u.output_tokens ?? 0 };
        }
      }
    }

    return { text, data: parseJsonLoose<T>(text), usage };
  }
}
