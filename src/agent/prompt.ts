import type { AgentRequest } from "./runner";

/** Shared by both real runners so they build prompts and parse output identically. */
export const JSON_INSTRUCTION =
  "Respond with a single JSON object only. No prose, no markdown, no code fences.";

export const buildAgentPrompt = (req: AgentRequest): string => {
  const context =
    req.payload === undefined ? "" : `\n\nContext:\n${JSON.stringify(req.payload, null, 2)}`;
  return `${req.instruction}${context}\n\n${JSON_INSTRUCTION}`;
};

/** Parse a model's text reply as JSON, tolerating ```json fences and stray prose. */
export const parseJsonLoose = <T>(text: string): T => {
  const fenced = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    return JSON.parse(fenced) as T;
  } catch {
    // Fall back to the first balanced {...} block if the reply has extra text.
    const start = fenced.indexOf("{");
    const end = fenced.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(fenced.slice(start, end + 1)) as T;
      } catch {
        /* ignore */
      }
    }
    return {} as T;
  }
};
