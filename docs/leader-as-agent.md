# Design — The Helm-Leader as a persistent agent

> Status: **proposal** (2026-06-24). Extends [DESIGN.md](../DESIGN.md). No code yet — this
> document is the spec we commit to before touching the engine.

---

## 1. Problem

Today the Helm-Leader is **not an agent**. It is a label on a sequence of stateless completions.

In `src/engine/orchestrator.ts` the Leader's work is three independent calls — write the spec
(`mode: "spec"`, ~line 315), design the workflow (`mode: "workflow"`, ~line 423), and reply to
mid-run messages (`mode: "steer"`, ~line 671). Each goes through `AgentRunner.run()`, which spawns
a fresh `claude -p` subprocess (`cli-runner.ts`) — or, in the SDK runner, a `query()` capped at
`maxTurns: 1` (`claude-runner.ts`). Every call:

- starts with **no memory** that it is "the same Leader" that acted a minute ago;
- carries only whatever context the TypeScript code re-stuffs into its prompt;
- has **no tools** (`--tools ""`, deliberately — see §3) so it cannot read the code it is
  supposedly coordinating;
- cannot be **talked to**: the UI's "Talk to your Helm-Leader" channel is mock
  (`web/js/app.jsx` streams a canned `leaderReply()`), and mid-run steering just appends a string
  to a `steering[]` array the next worker prompt happens to include.

The orchestration intelligence lives in `orchestrator.ts` control-flow, not in a Leader. That is a
fine design for the **workers** (Dev, Research, QA, Watchmen) — bounded, deterministic, cheap. It
is the wrong shape for a **leader**, whose entire job is to hold context across a run, look at the
work, decide what rigor it needs, and answer questions about it.

## 2. Why it is currently like that (so we change it deliberately)

It was a cost and control guard, not an oversight. The runner forces `--tools ""` to get, in its
own words, "a single answering turn [that] prevents them from wandering into a full agentic session
(which can balloon to millions of tokens)" (`cli-runner.ts`). That bought determinism, 81 passing
tests, a clean token ledger, and bounded spend — by trading away the Leader's agency.

The thesis of this proposal: **move agency up to the Leader, but keep it inside a fence.** The
teams stay bounded workers. The Leader becomes a real, stateful, tool-using, conversational agent —
and the TypeScript engine stops *being* the Leader and becomes the **guardrail** around it.

## 3. Goals / non-goals

**Goals**
- G1. The Leader holds **one continuous context** for a whole run (spec → workflow → delivery →
  Q&A), instead of N cold calls.
- G2. The Leader can be **talked to** mid-run and answer from its real context (kills the mock chat).
- G3. The Leader can **use read-only tools** (`Read`/`Grep`/`Glob`) to ground its decisions in the
  actual codebase.
- G4. Eventually, the Leader **decides delegations** (which team, what rigor, when) instead of a
  hardcoded TS sequence.

**Non-goals**
- N1. Turning the teams into open-ended agents. Dev/Research/QA/Watchmen stay one-shot workers.
- N2. Removing the safety rails. The human spec gate, the Watchmen drift check, the artifact/ledger
  discipline, and a hard per-run budget remain **mandatory** regardless of what the Leader decides.
- N3. Full emergent multi-agent autonomy ("the Leader spawns whatever it wants"). Explicitly out of
  scope — that is where it becomes an unbounded token furnace and loses the traceability that makes
  Helm trustworthy.

## 4. Invariants we must preserve

These do not change. They are the contract that keeps Helm honest, and the new Leader operates
*through* them, not around them:

- **I1 — Traceability.** Every task/review/drift verdict still references a requirement ID. The
  spec→work→drift matrix (`core/traceability.ts`) is still built and still gates "delivered".
- **I2 — Human spec gate.** No build work begins until a human approves the spec
  (`HumanInterface.approveSpec`).
- **I3 — Watchmen.** A drift check still runs before any run is reported "delivered".
- **I4 — Ledger.** Every model call is still recorded; `savingsReport` still produced.
- **I5 — Budget ceiling.** A run cannot exceed a configured token/turn budget. New, and load-bearing.
- **I6 — Determinism for tests.** The Mock runner still produces deterministic runs so the suite
  stays green offline.

## 5. Target architecture

### 5.1 A stateful session at the agent boundary

Extend the runner boundary (`src/agent/runner.ts`) with an optional **session** capability. The
stateless `run()` stays for the workers; the Leader gets a persistent session.

```ts
export interface AgentTurn {
  readonly instruction: string;
  readonly payload?: unknown;
  readonly tools?: readonly string[];
  readonly cwd?: string;
}

export interface AgentSession {
  readonly id: string;
  /** One turn in a persistent context; prior turns remain in scope. */
  send<T = unknown>(turn: AgentTurn): Promise<AgentResponse<T>>;
  close(): void;
}

export interface StatefulAgentRunner extends AgentRunner {
  openSession(opts: {
    readonly role: string;
    readonly model: string;
    readonly tools?: readonly string[];
    readonly cwd?: string;
  }): AgentSession;
}
```

Implementations:
- **CLI** (`ClaudeCliRunner`): a session is the `claude` session id; each `send()` is a
  `claude -p ... --resume <id>` call (transport stays stateless, the *context* is server-side and
  persists). Robust, survives a process restart, no long-lived child.
- **SDK** (`ClaudeAgentRunner`): a session wraps a streaming `query()` (drop `maxTurns: 1`; use the
  resume option or streaming-input mode). Enables live token streaming for observation (§8).
- **Mock** (`MockAgentRunner`): a trivial in-memory session that concatenates prior turns — keeps
  tests deterministic (I6).

The engine depends only on `AgentSession`; which transport provides continuity is hidden.

### 5.2 The Leader's tool surface

The Leader's session is given tools. Read-only ones are native Claude Code tools; the
**orchestration primitives** are Helm-provided custom tools (in-process MCP server), each backed by
an existing engine function and wrapped by the budget/checkpoint guard:

| Tool | Backs onto | Guard |
|---|---|---|
| `Read` / `Grep` / `Glob` | Claude Code (read-only) | confined to the workspace |
| `dispatch_team(team, instruction, payload)` | the existing stateless `runner.run()` + `runGate()` | budget; team allow-list |
| `verify_tests()` | `runVerification()` (`engine/verify.ts`) | build mode only |
| `check_drift()` | `buildMatrix` + Watchmen call (`core/traceability.ts`) | **mandatory before deliver** |
| `ask_human(question)` | `HumanInterface` | — |
| `write_artifact(kind, body)` | `persistRun` / store | schema-validated |

This is the heart of it: "delegate to Dev", "gate this", "run the tests", "ask the captain",
"check for drift" stop being hardcoded TS lines and become **tools the Leader calls in its loop**.
The engine supplies the tools and refuses the ones that would break an invariant or the budget.

### 5.3 The engine becomes a supervisor

`runHelm()` shrinks dramatically. It no longer *is* the Leader; it:

1. resolves config, workspace, budget, runner;
2. opens the Leader session with the run request and the tool surface;
3. lets the Leader drive, **intercepting every tool call** to: record the ledger, persist
   artifacts, and enforce I2/I3/I5 (a `dispatch_team` past budget is rejected; "deliver" is refused
   until the spec was human-approved and a drift check has run);
4. assembles the same `RunResult` from the artifacts the Leader produced.

The TS sequence (spec → ground → approve → workflow → triage → dev → verify → watchmen) becomes the
Leader's *default playbook* (in its role prompt), not an immovable control-flow. Triage
(`core/triage.ts`) stays available — the Leader calls it / follows it — so risk-proportional spend
survives.

### 5.4 The conversational channel becomes real

`UiSession` (`src/server/session.ts`) already owns the run. Once the Leader is a live session:
- `steer` / chat commands become `leaderSession.send()` turns → the Leader answers from real
  context; the reply streams back over SSE.
- `approveSpec` is the Leader's `ask_human` resolving.
- The mock `leaderReply()` in `web/js/app.jsx` is deleted; the chat shows the actual Leader.

## 6. Safety rails (the one real risk)

A tool-using agent in a loop is exactly what §2's guard protected against. We re-introduce agency
*with a fence*:

- **R1 — Hard budget.** A per-run token/turn ceiling (config, default e.g. ~budget per run). The
  supervisor rejects tool calls once crossed and asks the Leader to wrap up or escalate to human.
- **R2 — Bounded workers.** `dispatch_team` still calls the one-shot `runner.run()` with the
  existing `--tools` discipline. The Leader's agency is in *orchestration*, not in unleashing the
  workers.
- **R3 — Mandatory checkpoints.** `deliver` is unreachable until I2 (human-approved spec) and I3
  (drift check) have happened. Enforced by the supervisor, not by the Leader's good behavior.
- **R4 — Turn cap per phase.** Each Leader phase has a maxTurns so a single decision cannot loop
  forever.
- **R5 — Fallback path.** The current stateless orchestrator stays behind a flag until the agentic
  path is proven, so we can always fall back.

## 7. Observability / debug

This dissolves the "can I tmux into the agents?" question. With one persistent Leader session:
- its **full transcript** is persisted to `.helm/run-<id>/leader.transcript.md`;
- its turns **stream live** to the UI console (SDK stream-json), so you watch it reason and call
  tools in real time;
- each `dispatch_team` worker call still logs its prompt + raw response under
  `.helm/run-<id>/agents/` (a smaller, separate improvement that is useful regardless of this work).

## 8. Implementation plan (phased, keep the suite green)

Each phase is independently shippable and leaves tests passing. Ordered by value-per-risk.

- **Phase 1 — Persistent Leader context.** Add `AgentSession` / `StatefulAgentRunner` to the runner
  boundary; implement CLI (resume-by-id), SDK (streaming), Mock (in-memory). In `orchestrator.ts`,
  route the Leader's spec + workflow + steer calls through **one** session instead of three
  independent `run()` calls. No control-flow change yet. _Outcome:_ the Leader remembers across its
  own steps. _Risk:_ low.
- **Phase 2 — Real chat.** Wire `UiSession` steer/chat + `approveSpec` into the live session; delete
  the mock `leaderReply()`; stream replies over SSE. _Outcome:_ you can talk to the Leader mid-run
  and it answers from context. _Risk:_ low.
- **Phase 3 — Read-only Leader tools.** Give the Leader `Read`/`Grep`/`Glob` during spec + workflow
  so it grounds decisions in the real codebase (complements or subsumes the separate Research
  grounding pass). _Outcome:_ better, code-aware specs. _Risk:_ medium (tokens — bounded by R1/R4).
- **Phase 4 — Leader-driven delegation.** Introduce the orchestration tools (`dispatch_team`,
  `verify_tests`, `check_drift`, `ask_human`, `write_artifact`); move the supervisor enforcement in;
  let the Leader choose delegations. Behind a flag, with Phase-0 path as fallback. _Outcome:_ the
  Leader actually leads. _Risk:_ high — gated by R1–R5 and the fallback.
- **Cross-cutting — Observability (§7).** Land the per-worker transcript logs early (independent
  win); add live Leader streaming with Phase 1/2.

## 9. Acceptance criteria

- A1. A run's Leader shares one context across spec, workflow, and steering (verifiable: the Leader
  can reference an earlier decision without it being re-stuffed into the prompt).
- A2. Sending a chat message mid-run produces a reply derived from the live run state, not a canned
  string.
- A3. The Mock runner still drives a full deterministic run; the existing suite stays green.
- A4. A run cannot exceed the configured budget; crossing it escalates to human rather than looping.
- A5. The human spec gate and the Watchmen drift check still always run before "delivered".
- A6. `.helm/run-<id>/leader.transcript.md` contains the Leader's full reasoning for the run.

## 10. Open questions

- Q1. CLI `--resume` vs SDK streaming as the *primary* session transport — which becomes the default
  for the served UI? (Leaning SDK for live streaming; CLI as the portable fallback.)
- Q2. Does Phase 3's code-aware Leader make the separate Research *grounding* pass redundant, or do
  they stack?
- Q3. Budget policy on cross: hard-stop, or one "you're over budget, wrap up" turn then stop?
- Q4. Should `dispatch_team` itself be allowed to open sub-sessions later, or stay strictly one-shot
  (N1 says one-shot for now)?
