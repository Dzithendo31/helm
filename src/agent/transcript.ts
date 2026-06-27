import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  openSession,
  type AgentRequest,
  type AgentResponse,
  type AgentRunner,
  type AgentSession,
  type AgentTurn,
  type SessionOptions,
  type StatefulAgentRunner,
} from "./runner";

/**
 * Observability decorator: tees every agent call's prompt + raw response to disk
 * so a run is fully inspectable (and `tail -f`-able). Answers "what did I send the
 * Helm-Leader and what did it say" without changing any engine behaviour.
 *
 * Writes `transcript.md` (every call, in order) and `leader.transcript.md` (just
 * the Leader's session turns) under the run store.
 */
export class TranscriptRunner implements StatefulAgentRunner {
  private seq = 0;

  constructor(
    private readonly inner: AgentRunner,
    private readonly dir: string,
  ) {
    mkdirSync(dir, { recursive: true });
  }

  async run<T>(req: AgentRequest): Promise<AgentResponse<T>> {
    const res = await this.inner.run<T>(req);
    this.record(req.team, req.mode, req.instruction, req.payload, res, false);
    return res;
  }

  openSession(opts: SessionOptions): AgentSession {
    const inner = openSession(this.inner, opts);
    const record = this.record.bind(this);
    return {
      get id() {
        return inner.id;
      },
      async send<T>(turn: AgentTurn): Promise<AgentResponse<T>> {
        const res = await inner.send<T>(turn);
        record(opts.team, turn.mode, turn.instruction, turn.payload, res, true);
        return res;
      },
      close() {
        inner.close();
      },
    };
  }

  private record(
    team: string,
    mode: string,
    instruction: string,
    payload: unknown,
    res: AgentResponse,
    isLeader: boolean,
  ): void {
    const n = String((this.seq += 1)).padStart(2, "0");
    const payloadStr = payload === undefined ? "" : `\n\n\`\`\`json\n${safeJson(payload)}\n\`\`\``;
    const block =
      `## ${n} · ${team} · ${mode}\n` +
      `_${new Date().toISOString()} · in ${res.usage.inputTokens} / out ${res.usage.outputTokens} tok_\n\n` +
      `### → prompt\n${instruction}${payloadStr}\n\n` +
      `### ← response\n${res.text || "(empty)"}\n\n---\n\n`;
    try {
      appendFileSync(join(this.dir, "transcript.md"), block);
      if (isLeader) appendFileSync(join(this.dir, "leader.transcript.md"), block);
    } catch {
      /* transcripts are best-effort; never fail a run over logging */
    }
  }
}

const safeJson = (v: unknown): string => {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
};
