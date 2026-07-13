# Vinland Docs

Start with the contract: [`../AGENTS.md`](../AGENTS.md). It contains the always-on rules for agents
and overrides older notes in plans or commits.

## Core Design

1. [ARCHITECTURE.md](ARCHITECTURE.md) — package boundaries, command/snapshot flow, technology choices,
   save/load and multiplayer direction.
2. [ECS.md](ECS.md) — entities, components, systems, atomic actions, progression, and tick order.
3. [DATA-FORMAT.md](DATA-FORMAT.md) — the validated content IR and id conventions.
4. [TESTING.md](TESTING.md) — deterministic test pyramid and visual/audio limits.
5. [SCENES.md](SCENES.md) — acceptance scenes for human sign-off.
6. [SOURCES.md](SOURCES.md) — original file formats, source/oracle map, and legal statement.

## Tickets

[`tickets/`](tickets/) is the live work tracker: one file = one self-contained task, `features/`
for player-visible slices and area folders (`sim/`, `render/`, `app/`, `pipeline/`, …) for scoped
technical work. The user picks the next ticket and invokes `/worktree` on it; the completing commit
deletes the ticket file. Every workflow files tickets for real-but-deferred discoveries — see
[`tickets/README.md`](tickets/README.md) for the rules and template.

(`docs/plans/` was retired 2026-07-12: open work became tickets, the files live in git history.)

## Reference

- [PRIOR-ART.md](PRIOR-ART.md) — practices from other engine reimplementations. Optional, useful when
  choosing an architecture or validation approach.
- [GLOSSARY.md](GLOSSARY.md) — the project's domain vocabulary (formats, lattice terms, sim/test
  jargon), one entry each with a pointer to the detailed home.
- Package-local `AGENTS.md` files hold area-specific rules:
  `../packages/sim/AGENTS.md`, `../packages/render/AGENTS.md`,
  `../packages/app/AGENTS.md`, `../packages/audio/AGENTS.md`,
  `../tools/asset-pipeline/AGENTS.md`.

## Workflow Files

The agent contract is tool-agnostic: root `AGENTS.md` plus the package-local `AGENTS.md` files are
the single source of truth. Per-tool wiring:

- **Claude Code** — `CLAUDE.md` shims import `AGENTS.md`. Slash commands under `.claude/commands/`,
  reviewer lenses under `.claude/agents/`, and a committed PostToolUse hook
  (`.claude/settings.json` → `scripts/hooks/sim-determinism-guard.mjs`) that re-scans edited
  `packages/sim/src` files for forbidden nondeterminism at write time.
- **Codex CLI** — reads root and nested `AGENTS.md` natively; no extra config in the repo.
- **Gemini CLI** — `.gemini/settings.json` sets `contextFileName` to `AGENTS.md`; the root
  `GEMINI.md` shim covers launches from outside the repo, where that setting is not loaded.
- **Cursor** — reads root and nested `AGENTS.md` natively. `.cursor/commands/` holds thin shims
  that reuse the canonical workflows in `.claude/commands/`, applying reviewer lenses inline
  instead of as subagents.

The canonical workflow prose lives under `.claude/commands/` (shared by the shims, not Claude-only):

- `/worktree` — primary workflow: isolated branch/worktree, verify, review, update the ticket
  tracker, wait for user approval, fast-forward merge.
- `/audit` — report-only review battery over a diff.
- `/refactor-cleanup` — behavior-preserving refactor pass over a package, path, or feature.
- `/ticket-scout` — scan a scope for ticket candidates and file them as `docs/tickets/` entries.

Reviewer lens definitions live under `.claude/agents/` as plain-markdown checklists usable by any
tool: `engine-reviewer` (sim determinism, RTS-scale performance), `gameplay-reviewer` (source-basis
fidelity, player experience), `code-reviewer` (architecture, code quality).

Only Claude Code runs the write-time determinism hook; for every tool the authoritative gate is
`packages/sim/test/core/hygiene.test.ts` via `npm test` and CI.

## Lean Docs Rule

Do not add new running ledgers for old global planning, lessons, fidelity, or tech debt. Preserve only
current, actionable state:

- durable rules go in `AGENTS.md` or package-local `AGENTS.md`;
- active work goes in `docs/tickets/`;
- completed details stay in git history and commit messages;
- future work becomes a concrete, self-contained ticket.
