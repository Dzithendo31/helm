# Helm

A **reasoning agent orchestrator** on the Claude Agent SDK. Helm takes a request,
writes a **Spec of discrete requirements**, routes work through **teams of agents**
that gate their own artifacts, and verifies nothing drifted from the Spec — spending
tokens **proportional to risk**, not uniformly.

See [`DESIGN.md`](./DESIGN.md) for the full design and the REQ-1…REQ-15 requirements
this implementation traces back to.

## How it works

```
request
  └─ Helm-Leader: write Spec (REQ-1..n)
       └─ ❖ human approves Spec ❖   (mandatory, both modes)
            └─ Leader: design Workflow
                 └─ per requirement: triage(risk × confidence)
                      ├─ [Research] if high-risk/low-confidence
                      └─ Dev → gate (≤3 producer/critic cycles) → QA
                           └─ Watchmen: spec-drift check (reasoning only)
                                ├─ drift → halt
                                └─ clean → deliver
```

- **Teams** — `Helm-Leader`, `Research`, `Dev`, `Quality`, `Watchmen`. The Watchmen
  verify *spec fidelity* (missing / extraneous work) by reasoning over a traceability
  matrix; they never execute code.
- **Artifacts** — immutable, versioned `Spec`, `Workflow`, `Task`, `Review`, `Drift`,
  `Ledger`, persisted to `.helm/<runId>/`.
- **Dials** — `team-mode` (multi-agent gating vs single-agent pass) and `optimise-mode`
  (token ledger + counterfactual savings).

## Architecture

```
src/
  core/     # artifacts, lifecycle, traceability, triage, ledger — pure, no deps
  agent/    # AgentRunner interface + 3 implementations (see below)
  teams/    # team configs, markdown-role loader, the 3-cycle gate
  engine/   # orchestrator, checkpoints (human-in-the-loop), .helm store
  cli.ts
roles/      # editable markdown system prompts — change behavior without recompiling
```

The engine depends only on the `AgentRunner` interface, so the entire orchestration
runs and is tested **offline**. Three implementations:

| Runner | How it talks to Claude | Use |
|--------|------------------------|-----|
| `ClaudeCliRunner` (default) | spawns `claude --print` subprocesses; the role is the `--system-prompt`, so agents inherit Claude Code's full tool surface | real runs |
| `ClaudeAgentRunner` (`--sdk`) | in-process `@anthropic-ai/claude-agent-sdk` | alternative |
| `MockAgentRunner` (`--mock`) | deterministic, offline | tests / demos |

Roles live in `roles/*.md` and are loaded over the built-in defaults at startup —
edit them to change agent behavior without touching code.

## Usage

> See [USAGE.md](./USAGE.md) for the full guide (flags, modes, reading the artifact store).

```bash
npm install

# Offline demo (deterministic mock agents, no claude needed):
npm run dev -- "Build a URL shortener" --mock
npm run dev -- "Build a URL shortener" --mock --no-team-mode   # see optimise-mode savings

# Real run (spawns `claude --print` subprocesses; requires the claude CLI + auth):
npm run dev -- "Build a URL shortener"
npm run dev -- "Build a URL shortener" --autonomous
npm run dev -- "Build a URL shortener" --model claude-haiku-4-5-20251001 --bare  # cheaper
```

```bash
# Build mode: the Dev team writes REAL files into an isolated workspace (opt-in):
npm run dev -- "A TypeScript string reverse function with input validation" \
  --build --workspace ../helm-sandbox --no-team-mode
```

Flags: `--cli` (default) · `--sdk` · `--mock` · `--autonomous` · `--interactive` ·
`--no-team-mode` · `--no-optimise` · `--bare` · `--model <id>` · `--build` · `--workspace <dir>`.

> **Reasoning vs build.** By default all agents are **reasoning-only** (no tools, one
> turn each — keeps runs fast and bounded). `--build` gives *only the Dev team*
> `Read`/`Write`/`Edit`/`Bash` and runs it with `cwd` set to `--workspace`, so it
> produces real files. Helm refuses to `--build` inside its own repo.

> **Cost note:** each `claude --print` subprocess re-establishes Claude Code's base
> context (~30k+ cached tokens per call). `--bare` skips CLAUDE.md/hooks/plugins to cut
> this sharply, but requires `ANTHROPIC_API_KEY` auth.

## Development

```bash
npm test         # vitest (offline; no API key needed)
npm run typecheck
npm run build
```

## Status

v1 is a **reasoning orchestrator** — agents reason over artifacts; the Watchmen do not
run code. Real test execution (a sandbox at the Dev/QA layer) is intentionally out of
scope for v1.
