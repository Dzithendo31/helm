import { z } from "zod";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import type { LeaderToolkit } from "../engine/leader-toolkit";

/** MCP content envelope from a tool handler. */
const reply = (obj: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(obj) }] });

const risk = z.enum(["low", "medium", "high"]);

/**
 * Expose the supervisor's orchestration primitives to the Leader as in-process
 * MCP tools. The Leader calls these to drive the run; the handlers enforce the
 * budget + checkpoints inside the toolkit. The mandatory verify + drift checks
 * are NOT tools — the supervisor runs them after the Leader signals completion.
 */
export const buildLeaderMcpServer = (kit: LeaderToolkit) =>
  createSdkMcpServer({
    name: "helm",
    version: "0.1.0",
    tools: [
      tool(
        "set_spec",
        "Record the spec for this run and request human approval. Use the FEWEST distinct requirements; fold edge cases into acceptance criteria. Returns { approved, feedback? } — if not approved, revise and call again.",
        {
          title: z.string().optional(),
          requirements: z
            .array(
              z.object({
                statement: z.string().describe("one concise sentence"),
                acceptance: z.array(z.string()).optional(),
                risk: risk.optional(),
                confidence: risk.optional(),
              }),
            )
            .describe("the distinct requirements"),
        },
        async (args) => reply(await kit.setSpec(args)),
      ),
      tool(
        "dispatch_dev",
        "Delegate ONE approved requirement to the Dev team to implement. Returns { ok, files?, summary?, reason? }. Refused if the spec is unapproved or the budget is spent.",
        {
          reqId: z.string().describe('e.g. "REQ-1"'),
          statement: z.string(),
          acceptance: z.array(z.string()).optional(),
        },
        async (args) => reply(await kit.dispatchDev(args)),
      ),
      tool(
        "mark_complete",
        "Signal that every requirement has been dispatched. The supervisor then verifies tests and checks for spec drift.",
        {},
        async () => reply({ ok: true }),
      ),
    ],
  });
