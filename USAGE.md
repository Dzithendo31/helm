# Using Helm

A practical guide to running Helm. For the design and the `REQ-1…15` it implements,
see [`DESIGN.md`](./DESIGN.md).

## 1. Prerequisites

- **Node ≥ 20**
- For **real** runs: the `claude` CLI, installed and authenticated (`claude --version`).
- For **offline** runs: nothing else — `--mock` needs no `claude` and no auth.

## 2. Setup

```bash
npm install          # once
npm test             # optional: confirm the test suite passes
```

Run via `npm run dev -- "<request>" [flags]` (no build step needed; `tsx` runs the TS directly).

## 3. Your first run — offline, instant, free

```bash
npm run dev -- "Build a notes REST API with tags" --mock
```

```
Helm run run_1589c5d1 → DELIVERED
Spec: 2 requirements
Tasks: 2
Triage: 2×team-review
optimise-mode: spent 2100 tokens; ~0 saved via triage.
Artifacts: .../.helm/run_1589c5d1
```

`--mock` uses deterministic fake agents — perfect for seeing the pipeline shape and the
artifact store without spending anything.

## 4. A real run (reasoning mode — no files written)

```bash
npm run dev -- "Design an auth flow with refresh tokens"
```

This spawns real `claude` agents: the **Leader** writes a spec (and **pauses for your
approval** — type `y`), then Dev/QA/**Watchmen** reason over it. Nothing is written to disk
except the run's artifacts. Good for specs, plans, and reviews.

## 5. Build mode — Dev writes real files

```bash
npm run dev -- "Implement reverseString(s) in TypeScript with validation. One source file, one test file." \
  --build --workspace ../helm-sandbox --no-team-mode
```

- `--build` gives **only the Dev team** real `Read`/`Write`/`Edit`/`Bash`.
- `--workspace` is where files land (Helm **refuses** to build inside its own repo).
- Output ends with `Files written (N):` — verified against the filesystem, not the agent's claim.

## 6. Reading the results

Every run writes an inspectable store at `.helm/run_<id>/`:

| File | What it holds |
|---|---|
| `spec.md` | the requirements (`REQ-1…n`) the Leader wrote |
| `triage.md` | risk · confidence · rigor · rationale per requirement — *why* each got the effort it did |
| `workflow.json` | the Leader's plan |
| `tasks/*.json` | each task artifact (versioned, with provenance + files) |
| `reviews/*.json` | QA findings (Suggestions / Blockers / Questions) |
| `drift.md` | the Watchmen's matrix — `covered` / `partial` / `missing` / `extraneous` / `unsatisfied` |
| `ledger.json` | token / cost accounting |
| `spec.raw.txt` | (only on a failed/unparseable spec) the raw model output |

The terminal line gives the verdict: **DELIVERED**, **HALTED** (Watchmen found drift), or
**needs-human** (a blocker escalated, or you rejected the spec).

## 7. Flag reference

| Flag | Effect |
|---|---|
| *(default)* `--cli` | agents run as `claude --print` subprocesses |
| `--mock` | offline deterministic agents (no claude, no auth) |
| `--sdk` | use the Claude Agent SDK instead of subprocesses |
| `--build --workspace <dir>` | Dev writes real files into `<dir>` |
| `--interactive` *(default)* / `--autonomous` | human checkpoints vs one-artifact-back (spec approval is always required) |
| `--no-team-mode` | single-agent pass per team (skip QA gating) — faster/cheaper |
| `--no-optimise` | hide the savings report |
| `--model <id>` | force one model for all teams (e.g. `claude-haiku-4-5-20251001`) |
| `--bare` | skip CLAUDE.md/hooks/plugins per call — much less context tax (needs `ANTHROPIC_API_KEY`) |

## 8. Speed / token tips

- Iterating on Helm itself → `--mock` (free, instant).
- Cheap real runs → `--model claude-haiku-4-5-20251001 --no-team-mode`.
- Each subprocess reloads ~30k+ tokens of base context; `--bare` cuts that sharply on `ANTHROPIC_API_KEY` auth.

## 9. Customize behavior without recompiling

Agent personalities live in **`roles/*.md`** (`helm-leader.md`, `dev.md`, `quality.md`,
`watchmen.md`, `research.md`). Edit the markdown — it's loaded over the defaults at startup.
Point elsewhere with `HELM_ROLES_DIR=/path`.

## 10. Developer commands

```bash
npm test            # run the test suite (offline)
npm run typecheck   # tsc --noEmit
npm run build       # compile to dist/
```

## Caveats

- Real agents are **non-deterministic** — the same request can yield a different number of
  requirements or files.
- Dev currently *attests* `tested: true` without Helm actually executing the tests, so
  **verify generated code yourself** before trusting it.
