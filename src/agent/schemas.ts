/**
 * Explicit output schemas appended to agent instructions. Real models honor a
 * named-field shape far more reliably than "respond with JSON"; the parsers stay
 * tolerant of common aliases as a backstop, but this is the primary contract.
 */
export const SPEC_SCHEMA = `{
  "title": string,
  "requirements": [
    {
      "statement": string,            // one concise sentence
      "acceptance": [string],         // testable acceptance criteria
      "risk": "low" | "medium" | "high",        // blast radius if wrong
      "confidence": "low" | "medium" | "high",  // how well understood
      "rationale": string                       // one line: why this risk and confidence
    }
  ]
}`;

export const RESEARCH_SCHEMA = `{ "findings": string }`;

export const WORKFLOW_SCHEMA = `{
  "steps": [string],        // high-level plan, for the human
  "rationale": string,
  "execution": [
    { "req": "REQ-1", "dependsOn": ["REQ-2"] }
    // dependsOn = requirements that must finish first; list each requirement once.
    // Independent requirements (no dependsOn) run in PARALLEL — prefer parallelism
    // and only add a dependency when one requirement genuinely needs another's output.
  ]
}`;

export const TASK_SCHEMA = `{
  "title": string,
  "summary": string,
  "files": [string],     // relative paths of files you created or modified (omit if none)
  "tested": boolean      // true only if you wrote tests that would pass
}`;

export const REVIEW_SCHEMA = `{
  "findings": [
    { "kind": "Suggestion" | "Blocker" | "Question", "ref": string, "message": string }
  ]
}`;

export const DRIFT_SCHEMA = `{
  "requirements": [
    { "id": "REQ-1", "satisfied": true | false, "reason": string }
    // satisfied = does the delivered work actually meet this requirement's acceptance criteria?
  ],
  "extraneous": [
    { "what": string, "reason": string }
    // a file or piece of work that NO requirement asked for (scope creep)
  ]
}`;

export const withSchema = (instruction: string, schema: string): string =>
  `${instruction}\n\nReturn JSON exactly matching this shape (use these exact field names):\n${schema}`;
