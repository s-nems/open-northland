# AGENTS.md: Open Northland project contract

Open Northland is a TypeScript reimplementation of *Cultures - 8th Wonder of the World*. Read this
file before editing. Package-local `AGENTS.md` files add narrower rules.

`CLAUDE.md`, `GEMINI.md`, and client command files are adapters. Durable project rules belong here or
in the nearest package contract.

## Repository and legal boundary

The repository may sit beside an owned game installation and the CulturesNation `DataCnmd/` folder.
They are pipeline inputs only. Never commit original files, decoded content, binary probes, or
reference captures from the original.

This is an independent GPL-3.0-or-later implementation. Do not copy or translate another engine's
code. Base format and behavior work must use the sources allowed by `docs/SOURCES.md`. The canonical
legal wording is in `docs/LEGAL.md`.

## Non-negotiable rules

1. **The sim is pure and deterministic.** `packages/sim` cannot use `Math.random`, wall-clock time,
   DOM, I/O, Pixi, render, or app imports. Same seed and input must produce byte-identical state.
2. **Sim state is fixed-point.** Rendering may interpolate floats. Create `Fixed` values only through
   `fx.*`.
3. **Content is data.** Goods, jobs, buildings, tribes, graphics bindings, and balance belong in
   validated content or the committed fallback catalog. Systems must not grow id-specific rules.
4. **Use the strongest readable source.** Prefer mod `.ini`, then base plaintext `.ini`, then decoded
   `.cif`. Binary claims need byte-level evidence from the owned copy and synthetic tests.
5. **Name approximations.** A passing test proves internal behavior, not fidelity. Record whether a
   mechanic, constant, timing, or visual choice comes from extracted data, readable semantics,
   byte-level evidence, a published standard, observation, or an approximation.
6. **Treat scale as a budget.** Per-tick simulation work scales with active work, not entity pairs.
   Per-frame rendering and audio work scales with the visible screen, not the map.
7. **Keep durable context small.** Current tasks live in `docs/tickets/`. Stable rules live in an
   `AGENTS.md`. Completed investigation belongs in Git history.

## Code quality

- Prefer names and structure that explain the code without PR context.
- Comments state units, invariants, ownership, or source basis. Do not narrate obvious control flow or
  preserve development history.
- JSDoc is not required for every export, interface member, or local helper. Do not document a symbol
  when its name and type already state the contract.
- Keep comments tight. Most comments fit in one to three physical lines. Treat a block longer than five
  lines as a structural warning; retain it only when a protocol, security boundary, source basis, or
  indivisible invariant genuinely needs the space.
- Give each fact one durable home. Investigation, benchmarks, caller inventories, and decision history
  belong in tests, tickets, or the completing commit, not repeated in production JSDoc.
- When extracting or moving code, review comments across the old and new modules as one budget. Moving
  prose is not an improvement, and a behavior-preserving refactor should not grow that budget unless it
  exposes a previously unstated invariant. Do not add a module header or JSDoc to every new export by
  default.
- Refactor structure before adding a long comment about phases, branch purpose, or ownership.
- Group by feature. When a file passes roughly 300 lines or mixes concerns, extract the relevant
  concern into a feature folder and preserve public imports through a small barrel when useful.
- Delete dead code and commented-out blocks. Git is the archive.
- Deduplicate when a second real caller proves the shared concept. Do not add speculative helpers.
- Leave touched code cleaner, but do not turn a bounded task into a repository rewrite.
- Do not add another responsibility, narrative section, or longer orchestration path to an already
  overgrown file. Extract the concern related to the task; an existing or newly filed cleanup ticket
  does not permit making the file worse.
- Enforce boundaries through package structure, types, and existing lint or hygiene checks where
  possible. Do not add a one-off regex source scanner to prove a local refactor; reserve source scans
  for repository-wide syntactic contracts that cannot be expressed by those mechanisms.

Use strict TypeScript deliberately: no `any`, narrow `unknown`, prefer discriminated unions with
exhaustive switches, use string-literal unions rather than `enum`, mark stable data `readonly`, use
`import type`, and prove absence cases instead of using non-null assertions.

## Working with content

Before changing extraction or a content join, inspect all three:

1. the real source file in the owned copy;
2. the decoder or extractor;
3. generated `content/ir.json`.

Schema names, fixtures, and tickets are not source evidence. `.ini` keys are case-sensitive, list
shapes vary, and numeric ids may be scoped.

Decoded maps already carry final ground-pattern choices. The current observed projection is a
staggered raster with 68 px cell width, 38 px row step, elevation lift `TILE_HALF_H / 32`, and
pre-lift depth sorting.

The sim uses the original half-cell lattice: `2W x 2H`, with cell `(c, r)` at node
`(2c + (r & 1), 2r)`. Integer sim commands, footprints, and navigation use half-cell nodes.
Fixed-point positions use fractional visual-tile coordinates. `nav/halfcell.ts` is the conversion
seam; cell grids pass through `halfCellMapFromCells` before becoming a `TerrainGraph`.

## Tickets and workflow

One ticket under `docs/tickets/` describes one actionable task. Verify its claims before executing
it. Delete a completed ticket in the completing commit; rewrite a partial one to the exact remaining
work.

A ticket is a compact task specification, not an investigation transcript. State the verified
problem, bounded scope, and verification path; omit development history, large code excerpts, and
exhaustive caller inventories unless they are necessary to execute the task safely.

File deferred work only when it is verified, actionable, valuable enough to schedule, and not already
covered. Group closely related findings. Minor observations can stay in the current report instead of
becoming permanent tracker noise.

`/worktree` is the primary isolated workflow: create a worktree, implement one requested task, verify
and review it, update the ticket, ask for approval, then fast-forward merge. Other workflows are
documented under `.claude/commands/`.

## Verification

- Prove behavior at the lowest useful layer: unit, integration, headless scenario, then browser scene.
- Normal code expects `npm run check`, `npm run build`, and `npm test`.
- Pipeline and schema changes also need `npm run test:pipeline` against the owned copy.
- Real-content loaders and joins need `npm run test:content` when local content exists.
- Golden hashes move only for intentional behavior changes.
- Visual and audio changes need human review. Automated checks can prove data decisions, stability,
  and absence of obvious crashes, not final pixels or sound.
- Player-visible mechanics should have a registered acceptance scene when it adds useful state and
  presentation coverage.

Commands and local tools are listed in `docs/DEVELOPMENT.md`. Test modes are explained in
`docs/TESTING.md`.

## Package contracts

Load the relevant file when working in that area:

- `packages/sim/AGENTS.md`
- `packages/render/AGENTS.md`
- `packages/audio/AGENTS.md`
- `packages/app/AGENTS.md`
- `packages/desktop/AGENTS.md`
- `tools/asset-pipeline/AGENTS.md`
