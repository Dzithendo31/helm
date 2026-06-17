# Helm — Design

> An agent orchestrator native to Claude Code. Helm coordinates **teams of agents** that
> produce and gate **artifacts**, spending tokens **proportional to risk** rather than uniformly.
>
> Status: **design** (2026-06-15). No implementation yet. This document is Helm's own first
> Spec artifact — it is written the way Helm writes specs: as discrete, ID'd requirements that
> everything downstream traces back to.

---

## 1. Thesis

Most multi-agent systems review everything uniformly, which is slow and expensive, or review
nothing, which is unsafe. Helm's core idea is that **the orchestrator's main job is deciding how
much rigor each piece of work deserves** — and then spending exactly that much.

Two mechanisms make this real:

1. **A spec-requirement traceability matrix.** The Spec is a list of discrete, ID'd requirements.
   Every task, review, and drift check references those IDs. Nothing is orphaned; nothing is
   untraceable.
2. **Risk-based triage.** Before routing work, the Leader scores each unit by `risk × confidence`
   and assigns a rigor level. High-risk/low-confidence work gets research and multi-round review;
   low-risk/high-confidence work is accepted with little ceremony.

Helm is a **reasoning orchestrator**: agents reason over artifacts. The Watchmen never execute
code. Real test execution, if ever wanted, slots into the Dev/QA layer — explicitly out of scope
for v1.

---

## 2. Form factor

A **TypeScript application on the Claude Agent SDK**. The Helm-Leader and the teams are real
orchestration code — artifacts are objects passed between agents, the iteration loops are explicit,
and the token ledger is actual accounting. It can later be wrapped as a Claude Code plugin, but the
engine is standalone.

```
helm/
  src/
    core/        # artifacts, lifecycle state machine, traceability, ledger
    teams/       # leader, research, dev, quality, watchmen
    engine/      # orchestrator loop, routing, triage, checkpoints
    cli.ts       # `helm "build X"`
  package.json   # @anthropic-ai/claude-agent-sdk
  .helm/         # per-run artifact store (generated at runtime)
```

---

## 3. Core concepts

### 3.1 Artifacts

An **artifact** is the unit of work that is transferred, questioned, reviewed, and iterated on.
All artifacts share a common shape:

| Field        | Meaning                                                              |
|--------------|---------------------------------------------------------------------|
| `id`         | stable identity                                                     |
| `type`       | `Spec` \| `Workflow` \| `Task` \| `Review` \| `Drift` \| `Ledger`   |
| `version`    | artifacts are **immutable**; edits produce a new version            |
| `state`      | lifecycle state (§5.1)                                              |
| `refs`       | requirement IDs this artifact relates to                            |
| `provenance` | which agent/team produced/touched this version, when, and why       |
| `body`       | type-specific payload                                                |

Immutability matters: a run's history is a chain of versioned artifacts, which makes a run
inspectable, debuggable, and resumable.

### 3.2 The artifact types

- **Spec** — the north star. A list of discrete requirements `REQ-1 … REQ-n`, each with an ID, a
  statement, and acceptance criteria. **Always requires human approval** before any downstream work.
- **Workflow** — the plan the Leader designs for this request: which teams run, in what order, with
  what gates, sized to complexity. It is *itself* an artifact, so the chosen path (light vs heavy)
  is visible and reviewable.
- **Task** — a unit of work assigned to a team. Declares the `REQ` IDs it fulfills.
- **Review** — produced by QA. Composed of three kinds of findings, each pinned to a `REQ` or task:
  - **Suggestions** — optional improvements.
  - **Blockers** — hard changes that must be resolved before the artifact graduates.
  - **Questions** — things needing an answer (from another team or a human).
- **Drift** — the Watchmen's traceability matrix (§4.5). Verdict per requirement.
- **Ledger** — the running token/cost account that powers optimise-mode.

### 3.3 Traceability matrix

The backbone. A live mapping from every Spec requirement to the work that satisfies it:

| Requirement | Implemented by | Reviewed | Tested (attested) | Drift verdict   |
|-------------|----------------|----------|-------------------|-----------------|
| REQ-1       | task-3         | ✓        | ✓                 | **covered**     |
| REQ-2       | task-5         | ✓        | ✗                 | **partial**     |
| REQ-3       | —              | —        | —                 | **missing**     |
| (none)      | task-7         | ✓        | ✓                 | **extraneous**  |

Two drift directions both matter: **missing** (spec asked, nobody built) and **extraneous** (built,
spec never asked — scope creep).

### 3.4 Risk-based triage

For each unit of work, the Leader assigns:

- **risk** — blast radius if it's wrong.
- **confidence** — how sure the producing agent is.

and derives a **rigor level**:

| Rigor                  | When                                | Cost   |
|------------------------|-------------------------------------|--------|
| `skip`                 | low risk, high confidence           | lowest |
| `self-review`          | low risk, medium confidence         | low    |
| `team-review`          | medium/high risk                    | medium |
| `research-then-review` | high risk, low confidence           | high   |

This is the function optimise-mode reports on (§7.2).

---

## 4. Teams

A team is one or more agents. In `team-mode: on`, a team is **producer + critic(s)** with an
internal gating loop. In `team-mode: off`, a team collapses to a single agent doing a self-review
pass. The accountability principle: an artifact cannot leave a team until it passes that team's own
bar — teams don't want to hand each other embarrassing work.

### 4.1 Helm-Leader (1 agent)

Intake the request, write the Spec, design the Workflow, run triage, route artifacts, **break ties**
(e.g. Dev vs QA deadlock), assemble final output, and own the human conversation. The only agent
that talks to the human directly.

### 4.2 Research Team

The **only** team permitted to reach outside (web, docs, code search). Produces Research artifacts
that feed and de-risk the Spec and high-risk tasks. Invoked only when triage calls for it.

### 4.3 Dev Team

Turns Tasks into work products (code, configs, docs). Each Task links the `REQ` IDs it fulfills.

### 4.4 Quality (QA) Team

Reviews work products and produces **Review** artifacts (Suggestions / Blockers / Questions).
Owns *quality*, not *fidelity*.

### 4.5 Watchmen

**Spec-drift specialists, reasoning-only — they never run code.** They run **last**, after QA has
approved, and own the traceability matrix. They verify:

- every requirement is **built**, **reviewed**, and **tested** (where "tested" = the responsible
  team *recorded* a passing-test attestation that traces to a `REQ`; Watchmen confirm the
  attestation exists and is faithful — they do not execute anything),
- nothing is **missing**,
- nothing is **extraneous** (scope creep).

**Authority:** halt power on drift only. They guard *fidelity*. Cost is guarded elsewhere
(optimise-mode/Leader). They do not arbitrate quality disputes — that's the Leader's job.

---

## 5. Orchestration

### 5.1 Artifact lifecycle

```
Draft ──► InternalReview ──► TeamApproved ──► CrossTeamReview ──► Accepted
              │  ▲                                   │
       blockers │  └────────── bounce back ──────────┘
              ▼
        (max 3 cycles)
              │
              ▼
   Blocked / NeedsHuman   (escalation)
```

- An artifact graduates a team only at `TeamApproved` (passed internal critique).
- Cross-team review is where another team (or Watchmen) can raise findings.
- Unresolved blockers terminate at `Blocked` or `NeedsHuman`.

### 5.2 The 3-cycle rule

Every team gate runs **at most 3 producer→critic rounds**. If blockers remain after round 3, the
artifact escalates: first to the Leader (tie-break / re-scope), then to the human as a `NeedsHuman`
artifact. This guarantees termination — no infinite iteration, no runaway token burn.

### 5.3 End-to-end flow

```
request
  └─► Leader: intake ─► write Spec (REQ-1..n)
        └─► ❖ HUMAN APPROVES SPEC ❖   (mandatory, both modes)
              └─► Leader: design Workflow (sized to complexity)
                    └─► [Research?] ─► Dev (Tasks) ─► QA (Reviews)
                          └─► (3-cycle gating at each step)
                                └─► Watchmen: drift check vs Spec
                                      ├─ drift ─► halt ─► Leader / human
                                      └─ clean ─► Leader: assemble ─► deliver
```

### 5.4 Tie-breaking

When Dev and QA deadlock, the **Helm-Leader rules**. Watchmen never arbitrate quality; they only
veto on drift.

---

## 6. Run modes

Both modes use the **same checkpoints**; they differ only in who resolves them.

| Aspect              | Interactive                                   | Autonomous                                          |
|---------------------|-----------------------------------------------|-----------------------------------------------------|
| Spec approval       | human (mandatory)                             | **human (mandatory — the one break in autonomy)**   |
| Other checkpoints   | human, in-process                             | auto-resolved by Helm                               |
| Spontaneous input   | yes — when a team can't resolve / deadlocks   | only at the **must-ask floor**                      |
| Final delivery      | incremental                                   | **one artifact** (PR / Spec / what was asked)       |

**Must-ask floor** (autonomous mode breaks for these only): credentials, and irreversible or
product decisions only a human can make.

---

## 7. Dials

### 7.1 team-mode (rigor)

- **on** — teams are multi-agent producer/critic with internal gating. Higher rigor, higher cost.
- **off** — each team is a single agent doing a self-review pass. Lower rigor, lower cost.

### 7.2 optimise-mode (cost)

The accountant. Tracks the Ledger and reports **counterfactual savings left on the table** — not
just what was spent, but what could have been saved:

- re-running full artifacts where a smaller-scope re-run would have sufficed,
- reviewing low-risk units that triage would have skipped,
- using a larger model where a smaller one would have done.

The framing is a nudge: "you could have saved ~X tokens by …".

---

## 8. Persistence

A run writes a real, inspectable file store:

```
.helm/
  run-<id>/
    spec.md            # requirements REQ-1..n  (north star)
    workflow.json      # the plan the Leader chose
    tasks/             # task artifacts, each linking REQ ids
    reviews/           # Suggestions / Blockers / Questions
    drift.md           # Watchmen's traceability matrix
    ledger.json        # token / cost account (optimise-mode)
```

Because artifacts are versioned and immutable, a run is **resumable** and every team's output is
readable after the fact.

---

## 9. Requirements (Helm specced as itself)

The capabilities a first build must satisfy. Future work traces back to these IDs.

- **REQ-1** — Represent artifacts as immutable, versioned objects with type, state, refs, and
  provenance.
- **REQ-2** — Author a Spec as discrete ID'd requirements with acceptance criteria.
- **REQ-3** — Require human approval of the Spec in **both** run modes before any downstream work.
- **REQ-4** — Leader designs a Workflow artifact sized to request complexity.
- **REQ-5** — Triage each work unit by `risk × confidence` into a rigor level and route accordingly.
- **REQ-6** — Maintain a live traceability matrix mapping every `REQ` to its task/review/test status.
- **REQ-7** — Run team gates as producer/critic loops bounded to 3 cycles, then escalate.
- **REQ-8** — Research team is the only team with external (web/docs/code) access, invoked by triage.
- **REQ-9** — QA produces Review artifacts (Suggestions / Blockers / Questions) pinned to refs.
- **REQ-10** — Watchmen perform reasoning-only spec-drift verification (missing + extraneous), run
  last, with halt power on drift only.
- **REQ-11** — Leader breaks Dev-vs-QA ties; Watchmen do not arbitrate quality.
- **REQ-12** — Support Interactive and Autonomous modes sharing the same checkpoints, with a
  must-ask floor in autonomous mode.
- **REQ-13** — team-mode toggles multi-agent vs single-agent rigor per team.
- **REQ-14** — optimise-mode maintains a Ledger and reports counterfactual savings.
- **REQ-15** — Persist a run to a `.helm/run-<id>/` store; runs are resumable and inspectable.

---

## 10. Out of scope (v1)

- **Code execution / real test running.** Helm is reasoning-only at the Watchmen layer; "tested"
  is an attestation, not an execution. A sandbox could later attach at the Dev/QA layer.
- Claude Code plugin packaging (the engine is standalone first).
- Multi-run / cross-project memory of artifacts.

---

## 11. Glossary

- **Artifact** — an immutable, versioned unit of work (Spec, Workflow, Task, Review, Drift, Ledger).
- **Requirement (REQ)** — a discrete, ID'd line item in the Spec; the unit of traceability.
- **Rigor level** — how much review/research a unit gets, set by triage.
- **Gate** — a team's internal producer/critic loop an artifact must pass to graduate.
- **Drift** — divergence of built work from the Spec, in either direction (missing / extraneous).
- **Must-ask floor** — the minimal set of decisions autonomous mode will still surface to a human.
