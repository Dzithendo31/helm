# Helm v2 — Greenfield Handover

> For the team rebuilding Helm from scratch, iteratively. v1 is **frozen** as a reference
> implementation (this repo, `main` @ `89e74cb`). Nothing here says "port the code" — it says
> "here is what we learned building it once, so you can build it right the second time."
>
> Written 2026-07-01, after ~28 commits and 96 tests took v1 from a batch orchestrator to a
> Leader-driven, budget-fenced, observable agent system.

---

## 0. How to read this

Three questions this document answers:
1. **What is Helm, really?** (the thesis — the one thing that must survive the rewrite)
2. **What did v1 get right and wrong?** (so you keep the wins and skip the scar tissue)
3. **In what order should v2 be built?** (essential → necessary → nice-to-have, as shippable slices)

If you read one section, read **§7 (build order)** and **§8 (landmines)**.

---

## 1. The thesis (do not lose this)

**Helm's reason to exist: the orchestrator's main job is deciding how much rigor each piece of
work deserves, and then spending exactly that much.** Most multi-agent systems either review
everything (slow, expensive) or nothing (unsafe). Helm scores each unit of work by
`risk × confidence`, assigns a rigor level, and routes accordingly — high-risk/low-confidence work
gets research + multi-round review; low-risk/high-confidence work is accepted with little ceremony.

Two mechanisms make it real, and both must exist early in v2:
1. **A spec-requirement traceability matrix.** The spec is a list of discrete, ID'd requirements
   (`REQ-1`, `REQ-2`, …). Every task, review, and drift verdict references those IDs. Nothing is
   orphaned; nothing is untraceable.
2. **Risk-based triage.** Rigor is chosen per requirement, not applied uniformly.

Everything else — the UI, the teams, autonomy, transcripts — is in service of this. If a v2 feature
doesn't help decide-or-spend rigor proportionally, it's nice-to-have.

---

## 2. v1 by the numbers (what you're inheriting)

- **~4,500 LOC of engine** (`src/`, 44 files) + **~2,200 LOC of web UI** (`web/js/`, 11 files).
- **96 tests, 17 files.** The engine is well-covered and offline-deterministic. The UI is not tested.
- **The store:** every run writes an inspectable `.helm/<runId>/` folder — `spec.md`, `workflow.json`,
  `tasks/`, `reviews/`, `drift.md` (the traceability matrix), `ledger.json`, `verification.md`,
  `transcript.md`. This is one of v1's best ideas — keep it.
- **Two orchestration paths coexist** (see §5): the classic engine-sequenced path and the
  Leader-driven agentic path. That duality is tech debt v2 should not reproduce.

---

## 3. The layered model (the shape that worked)

v1's layering was sound. Keep this separation in v2:

```
core/     Pure domain types + logic, no I/O. Spec, Requirement, Artifact, lifecycle,
          Review, Ledger, Traceability matrix, Triage. Trivially unit-testable.
agent/    The agent boundary: one interface (AgentRunner) with a Mock (offline/
          deterministic), a CLI runner (spawns `claude -p`), and an SDK runner.
engine/   Orchestration: turns a request into artifacts using core + agent. The store,
          verification, budget, scheduler.
server/   Engine-as-service: a UiState contract, an HTTP server (state + SSE + commands),
          a session that bridges engine events → UI.
web/      The IDE that binds to the server.
```

The dependency arrow points one way: `web → server → engine → agent → core`. Respect it.

---

## 4. What v1 got RIGHT (keep the ideas)

1. **The agent boundary + a Mock, first.** `AgentRunner` is one method: `run(req) → {text, data, usage}`.
   Because a `MockAgentRunner` implements it deterministically, the *entire engine is testable
   offline* — 96 tests, no tokens, no network. This is v1's single best decision. **Do it in your
   first week.**
2. **Artifacts as first-class, ID'd, traceable objects.** Spec → Task → Review → Drift matrix, all
   referencing `REQ-*` ids, all persisted. The `.helm/<runId>/` store makes every run inspectable
   and post-mortem-able.
3. **A lifecycle state machine on artifacts** (`Draft → NeedsHuman → Accepted`, etc.) with *validated
   transitions*. It caught real bugs (an illegal `Draft → Accepted` in the agentic path).
4. **The token ledger + optimise-mode counterfactuals.** Every model call is recorded; "savings"
   are computed against the rigor you *didn't* spend. This makes the thesis measurable.
5. **A reporter/event channel** the engine emits into, decoupled from any renderer (CLI spinner or
   SSE-to-UI). Clean seam.
6. **Resilience by default.** One agent call failing (timeout, bad output) degrades *that requirement*
   to `NeedsHuman` — it never crashes the run. Wrap every external call.
7. **Risk triage → proportional rigor**, with the counterfactual recorded ("skipped QA on REQ-1,
   would have cost ~300 tokens"). This is the thesis, implemented.

---

## 5. What v1 got WRONG (do differently)

1. **The Leader started as a stateless puppet, and we spent five phases fixing it.** In early v1 the
   "Helm-Leader" was three disconnected `claude -p` calls (spec, workflow, steer) with no shared
   memory, no tools, and a mocked chat. All the orchestration intelligence lived in TypeScript
   control-flow, not in a leader. Phases 1–4 (commits `a24354a`→`89e74cb`) rebuilt it into a
   persistent, tool-driving agent. **v2 should decide up front what the Leader is** (see §6).
2. **A 934-line `orchestrator.ts` monolith.** The run sequence was hardcoded in one giant function.
   When we finally wanted the Leader to *drive*, we had to extract the operations into a `leader-toolkit`
   — which now **duplicates** logic with the monolith. **Design the orchestration operations as a
   clean, standalone toolkit from day one** (see §6).
3. **The UI was imported from a design mock and fought us for weeks.** It shipped full of fake data,
   a `?live` toggle, dead demo code, and mock sections (Templates/Repo) that did nothing. We spent
   real effort deleting slop and wiring mock components to live state. **In v2, build the UI against
   the real `UiState` contract from the first screen. Never seed it with fake data you'll later have
   to excise.**
4. **Two orchestration paths now coexist** (`orchestrator.ts` sequences vs `orchestrator-agentic.ts`
   where the Leader drives). Necessary for a safe migration in v1; pure debt in a greenfield. **Pick
   one path** — see §6.
5. **Prompt fragility bit us repeatedly.** The spec agent over-decomposed (6 requirements for a
   one-line function) until the prompt was tightened hard ("FEWEST requirements, fold edge cases into
   acceptance criteria"). **Treat spec-sizing as a first-class, tested behavior, not a prompt you
   tweak once.**
6. **Verification assumed a test runner existed.** A `--build` into a bare folder wrote correct code
   + tests but couldn't run them (no `package.json`/vitest), so the Watchmen flagged false drift and
   halted a *correct* delivery. We fixed it by running `node:test` files via a bundled `tsx`. **Decide
   early how Helm executes the tests it writes, across ecosystems.**

---

## 6. The central v2 decision: what is the Leader, and when?

v1's whole arc was the tension between two architectures:

- **A) Engine-as-brain (v1's start):** TypeScript sequences fixed steps; agents are stateless
  oracles. Deterministic, cheap, trivially testable — but the "Leader" isn't an agent, can't adapt,
  can't be talked to, doesn't use tools.
- **B) Leader-as-agent (v1's end):** the Leader is a persistent session that *drives* the run by
  calling tools (`set_spec`, `dispatch_dev`, …), with the engine demoted to a supervisor enforcing a
  budget + mandatory checkpoints. Real, conversational, tool-using — but non-deterministic, costlier,
  needs the SDK (in-process MCP tools don't work through the CLI runner), and hard to unit-test.

**The recommendation for v2: design the orchestration operations as a clean toolkit of primitives
from M3 (below). Drive them with a deterministic sequencer first; let the Leader drive them later —
as an *exposure*, not a rewrite.**

Concretely: `propose_spec`, `dispatch(reqId)`, `review(artifact)`, `verify()`, `check_drift()` should
be pure-ish functions with one owner each. A fixed `Sequencer` calls them in order (deterministic,
100% testable with the Mock). Later, the same functions become MCP tools and the Leader calls them —
same functions, same budget/checkpoint guards, no duplication. v1 proved both halves work; it just
built them in the wrong order and ended up with two copies. **You get to build the toolkit once and
have both the deterministic path (for tests + fallback) and the agentic path (for real runs) share
it.**

Guardrails that must exist the moment the Leader can loop (they're cheap and load-bearing):
- **A budget fence** (token + tool-call ceilings; over-budget work escalates to a human).
- **Mandatory checkpoints** the Leader cannot skip: the human spec-approval gate and the drift check
  must run before any run is "delivered," enforced by the supervisor, not the Leader's good behavior.

---

## 7. Proposed iterative build order

Each milestone is a **shippable, demoable slice**. The column that matters: *the question it lets you
answer*. Build in order; don't skip ahead to autonomy or UI before the thesis is proven.

### Essential — the irreducible Helm (without these it isn't Helm)

| M | Slice | The question it answers | Done when |
|---|-------|------------------------|-----------|
| M0 | **Walking skeleton**: request → (hardcoded) spec → `.helm/<id>/` store on disk. No agents. | Does the plumbing + artifact store work? | A run writes an inspectable folder. |
| M1 | **Agent boundary + Mock first.** `AgentRunner` interface; `MockRunner`; TDD "spec from request." Then one real runner behind the same interface. | Can the engine run fully offline and deterministically? | Spec-from-request is green with the Mock; the real runner is a drop-in. |
| M2 | **Spec = ID'd requirements + human approval gate.** | Is work traceable, and is there a human in the loop? | Spec is `REQ-*`; a run blocks on approval and resumes. |
| M3 | **The operations toolkit + a deterministic Sequencer.** `dispatch(reqId) → Task artifact`; build the traceability matrix. | Does delivered work map back to the spec? | A requirement produces a task; the matrix shows coverage. Toolkit functions are standalone + tested. |

### Necessary — makes it trustworthy and proves the thesis

| M | Slice | The question it answers | Done when |
|---|-------|------------------------|-----------|
| M4 | **Risk triage → proportional rigor + the ledger.** Review high-risk work, skip low-risk, record the counterfactual. | **Does Helm spend proportional to risk?** (the thesis) | Two requirements of different risk get visibly different rigor; the ledger shows the savings. |
| M5 | **Drift check (the Watchmen).** Does delivered work satisfy each requirement's acceptance criteria? Halt on drift. | Can Helm catch when it didn't build what was asked? | A deliberately-wrong task is flagged; a correct one delivers. |
| M6 | **Real file output + real test execution.** Build mode writes files into a workspace and *runs the tests it writes* (across ecosystems). | Does it produce real, *verified* artifacts, not just reasoning? | A `reverseString` build writes files, runs tests, delivers. |
| M7 | **The Leader drives (expose the M3 toolkit as tools) + the budget fence.** | Can the Leader orchestrate autonomously, safely? | A real run: Leader calls the tools end-to-end; budget/checkpoints hold; the deterministic Sequencer remains as fallback + test path. |

### Nice-to-have — leverage and polish

| M | Slice | Notes |
|---|-------|-------|
| M8 | **Live event stream + a minimal real UI**, built against the real `UiState` contract. | Do NOT import a design mock full of fake data. Start from the contract. |
| M9 | **Mid-run steering / real chat with the Leader.** | Trivial once the Leader is a live session (M7). |
| M10 | **Transcripts / observability.** Tee every prompt+response to the store. | Cheap decorator; invaluable for debugging autonomy. Consider from M7. |
| M11 | **Optimise-mode savings accounting, parallel scheduler, team sub-agents, graph/"brain" views.** | Genuine polish. None prove the thesis; sequence by user demand. |

Two notes on ordering:
- **The thesis is provable at M4.** That's your first "this is actually Helm" demo. Resist building
  UI or autonomy before it.
- **Autonomy (M7) is deliberately late** and is an *exposure* of M3's toolkit, not a rewrite. This is
  the single most important sequencing lesson from v1.

---

## 8. Landmines (concrete traps v1 hit — put these in your test suite)

- **Over-decomposition.** LLMs split one function into many requirements. Enforce "fewest distinct
  requirements; fold edge cases into acceptance criteria" and *test* the requirement count on a
  known-simple request.
- **Verifying in a bare workspace.** Helm writes tests, then can't run them (no project/test runner).
  Decide your cross-ecosystem test-execution story early (v1 ran `node:test` files via a bundled
  `tsx`). Don't let "no test command found" masquerade as drift.
- **Drift false-positives.** The drift checker halted correct work because it lacked *evidence* tests
  passed. Feed verification results into the drift check; distinguish "unverifiable" from "wrong."
- **Lifecycle transitions.** `Draft → Accepted` is illegal; it must pass through `NeedsHuman`. A
  validated state machine catches this — but only if every path uses it.
- **MCP tools require the SDK.** In-process custom tools (`createSdkMcpServer`/`tool`) work through the
  Agent SDK's `query()`, **not** through a spawned `claude -p` CLI. If the Leader drives via tools, the
  Leader runs on the SDK; workers can still be CLI. Plan the runner split.
- **Long-running tool handlers.** A tool that awaits human approval can outlast the SDK's stream-close
  window — widen `CLAUDE_CODE_STREAM_CLOSE_TIMEOUT`.
- **Agent scaffolding creep.** Left unconstrained, the Dev agent adds `package.json`/config/README you
  didn't ask for (which then breaks verification). Constrain it explicitly and test that it doesn't.
- **UI slop.** Mock data seeded into the UI becomes weeks of deletion later. Bind to real state from
  screen one.
- **One timeout crashing the run.** Every external call needs its own try/catch that degrades to
  `NeedsHuman`.

---

## 9. Testing approach that worked (adopt it)

- **Mock-runner-first TDD.** Because the agent boundary has a deterministic mock, write the engine
  test before the behavior. 96 tests run in ~0.5s with zero tokens.
- **Pure `core/` is trivially testable** — keep domain logic free of I/O.
- **Validate real runs sparingly but for real.** The deterministic suite proves logic; a handful of
  live runs prove the prompts + integration. Every big v1 behavior change ended with one real run
  (they repeatedly surfaced bugs the mock couldn't).
- **The UI was the weak spot** (untested, mock-derived). In v2, at least smoke-test the real UI
  against the contract (Playwright: loads, no page errors, key controls reflect real state).

---

## 10. Open questions for v2 to decide

1. **One path or two?** Recommendation: one toolkit, a deterministic Sequencer as the test/fallback
   path, the Leader as the production driver. Don't ship two full orchestrators.
2. **Runner strategy.** SDK-only (needed for Leader tools, cleaner) vs CLI+SDK split (v1's mix). The
   SDK also gives streaming (live Leader observability) and a native `maxBudgetUsd`.
3. **How much autonomy?** v1 stopped at "Leader dispatches; supervisor runs mandatory checkpoints."
   Full emergent autonomy (Leader spawns arbitrary sub-agents) was explicitly out of scope — it's
   where cost/traceability break down. Decide the ceiling deliberately.
4. **Where does QA/review live in the agentic path?** v1's agentic toolkit skipped QA (delivered work
   showed as "partial" coverage). Fold review into the toolkit so both paths gate equally.
5. **Test execution as a first-class subsystem** (multi-language), not an afterthought.
6. **Human interface shape.** Approval + questions + steering flowed through one `HumanInterface` in
   v1 — a good seam; keep it, and make the UI the primary implementation from the start.

---

## 11. Reference map (concept → where to look in frozen v1)

| Concept | File(s) |
|---------|---------|
| Thesis / original spec | `DESIGN.md` |
| The Leader-as-agent rationale | `docs/leader-as-agent.md` |
| Domain types (spec, artifact, lifecycle, review, ledger, triage, traceability) | `src/core/*` |
| Agent boundary + runners (mock/cli/sdk) + sessions | `src/agent/runner.ts`, `mock-runner.ts`, `cli-runner.ts`, `claude-runner.ts` |
| The deterministic orchestrator (the monolith — read as a spec, not a template) | `src/engine/orchestrator.ts` |
| The operations toolkit + agentic driver | `src/engine/leader-toolkit.ts`, `orchestrator-agentic.ts`, `src/agent/leader-mcp.ts` |
| Budget fence | `src/engine/budget.ts` |
| Real test execution | `src/engine/verify.ts` |
| Run store (the `.helm/` layout) | `src/engine/store.ts` |
| Triage / proportional rigor | `src/core/triage.ts`, `src/teams/gate.ts` |
| Drift / traceability matrix | `src/core/traceability.ts` |
| Engine-as-service (contract, http, session bridge) | `src/server/*` |
| Observability decorator | `src/agent/transcript.ts` |
| The UI (caveat: mock-derived; read for the contract binding, not as a model) | `web/js/app.jsx`, `web/js/*` |

---

### One sentence to hand the team

*Build the traceability + risk-triage core first and prove the thesis by M4; design the orchestration
operations as one clean toolkit that a deterministic sequencer drives now and the Leader drives later;
and never seed the UI with fake data.*
