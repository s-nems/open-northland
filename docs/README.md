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

## Plans

`docs/plans/` is the live planning surface. The user writes or updates a plan, then invokes
`/worktree` for one step at a time. The executing agent updates the same plan before asking to merge:
tick the step, add a short progress note, and record any source-basis or approximation that matters.

Current plans:

- [plans/original-ui.md](plans/original-ui.md) — original in-game HUD extraction and rebuild.
- [plans/gathering-economy.md](plans/gathering-economy.md) — faithful resource gathering, piles,
  felling, mining, and collision.
- [plans/combat.md](plans/combat.md) — combat, stances, damage, projectiles, recruitment, towers.
- [plans/map-visual-fidelity.md](plans/map-visual-fidelity.md) — map-import visual gaps against
  original screenshots.
- [plans/sim-perf.md](plans/sim-perf.md) — remaining deterministic perf follow-ups (ring-search
  migration, content indexes, sim-in-a-worker).

Plan hygiene: the checkbox is a step's only status marker. When a step merges, tick its box and
delete its prompt block (the progress note carries the state; git history keeps the prompt).
Delete a plan when all its steps land and no pending decision remains.

## Reference

- [PRIOR-ART.md](PRIOR-ART.md) — practices from other engine reimplementations. Optional, useful when
  choosing an architecture or validation approach.
- Package-local `AGENTS.md` files hold area-specific rules:
  `../packages/sim/AGENTS.md`, `../packages/render/AGENTS.md`,
  `../packages/app/AGENTS.md`, `../tools/asset-pipeline/AGENTS.md`.

## Workflow Files

Claude Code shortcuts live under `.claude/commands/`:

- `/worktree` — primary workflow: isolated branch/worktree, verify, review, update plan, wait for
  user approval, fast-forward merge.
- `/audit` — report-only review battery over a diff.
- `/plan` — research/author a new plan, or reconcile an existing one against code reality.

Reviewer agents live under `.claude/agents/` and are intentionally small: sim determinism, RTS-scale
performance, source-basis/fidelity, architecture, and code quality.

A committed PostToolUse hook (`.claude/settings.json` → `scripts/hooks/sim-determinism-guard.mjs`)
re-scans every edited `packages/sim/src` file for forbidden nondeterminism patterns at write time;
the authoritative gate stays the sim hygiene test.

## Lean Docs Rule

Do not add new running ledgers for old global planning, lessons, fidelity, or tech debt. Preserve only
current, actionable state:

- durable rules go in `AGENTS.md` or package-local `AGENTS.md`;
- active work goes in `docs/plans/`;
- completed details stay in git history and commit messages;
- future work becomes a concrete plan step or external issue.
