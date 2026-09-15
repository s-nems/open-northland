# AGENTS.md: Open Northland project contract

Open Northland is a TypeScript reimplementation of *Cultures - 8th Wonder of the World*. Read this
file before editing. Package-local `AGENTS.md` files add narrower rules.

`CLAUDE.md` and client command files are adapters. Durable project rules belong here or in the
nearest package contract.

## Repository and legal boundary

The repository never contains original game files, mod files, decoded content, binary probes, or
reference captures from the original. `npm run check:assets` rejects tracked `content/`, original
file types, and unreviewed binaries; review covers the rest. The CulturesNation mod archive is the
pipeline's only input and a build input: a release converts the pinned archive once and ships the
decoded content inside the desktop installers and the web image, which go no further than the
repository's releases and GHCR packages. The original assets are a stand-in while the project's own
are made. An owned game installation beside the checkout serves reverse-engineering evidence, never
the pipeline.

This is an independent AGPL-3.0-or-later implementation. Do not copy or translate another engine's
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
   Per-frame rendering and audio work scales with the visible screen, not the map. Measure that claim
   instead of asserting it: `docs/DEVELOPMENT.md` says which tool answers which question, and what
   voids a measurement.
7. **Keep durable context small.** Current tasks live in `docs/tickets/`. Stable rules live in an
   `AGENTS.md`. Completed investigation belongs in Git history.

## Code quality

- Prefer names and structure that explain the code without PR context.
- Prefer no comment when names, types, and tests already state the contract. A useful comment records
  one otherwise-hidden fact: a unit, invariant, ownership boundary, non-obvious constraint, or source
  basis. Do not narrate control flow or restate the implementation.
- Comments describe the current contract, never its history. Never put calendar dates, user/author
  attribution, conversation, plan, ticket, or PR references, or labels such as "user decision",
  "feedback", or "revised" in code comments. State source basis impersonally (`manual`, `.ini` key,
  byte evidence, observation, or approximation); keep decision history in the ticket or commit.
- JSDoc is not required for every export, interface member, or local helper. Do not document a symbol
  when its name and type already state the contract.
- Write one direct sentence about one fact. Most comments fit in one to three physical lines; treat
  anything longer as a structural problem and shorten the comment, improve the code, or move the detail
  to a test, ticket, or focused document. Only indivisible protocol layouts, security/legal boundaries,
  and byte-level format evidence justify a longer block.
- Do not write mini design documents above modules or exports. Avoid phase and caller inventories,
  `{@link}` chains that restate the import graph, repeated examples, rhetorical asides, emphasis
  through capitals, and chains of parenthetical remarks.
- When behavior changes, rewrite or delete its comment so only the new invariant remains; never append
  a dated correction or revision note. Leave unrelated historical comments to a dedicated comment
  pass instead of widening a feature diff.
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

## Persisted state

The game is unreleased: no save or fixture exists outside this repository and its developers'
machines. Persisted formats are replaced, never migrated:

- A layout change bumps the format's version and regenerates its committed fixture in the same
  commit. A reader accepts exactly its own version and rejects every other one. Do not write
  version-lifting steps, keep historical fixtures, or tolerate a field an older build wrote or omitted.
- Do not keep a code path only so an old golden, state hash, component shape, or hand-made test
  fixture survives. Fix the fixture and move the golden in the same commit, naming the behavior change.
- Generated content is gated, not migrated; `packages/data/AGENTS.md` owns that gate.

## Working with content

Before changing extraction or a content join, inspect all three:

1. the real source file in the mod archive;
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
- Pipeline and content schema changes also need `npm run test:pipeline` against the local mod.
- Own-art build and delivery changes follow `docs/art/PIPELINE.md` verification; changed content joins
  still require the real-content checks below.
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

- `docs/art/AGENTS.md`
- `packages/sim/AGENTS.md` (and `packages/sim/src/systems/missions/AGENTS.md`)
- `packages/lockstep/AGENTS.md`
- `packages/net-protocol/AGENTS.md`
- `packages/net-client/AGENTS.md`
- `packages/net-server/AGENTS.md`
- `packages/render/AGENTS.md`
- `packages/audio/AGENTS.md`
- `packages/app/AGENTS.md`
- `packages/data/AGENTS.md`
- `packages/desktop/AGENTS.md`
- `tools/asset-pipeline/AGENTS.md`
- `tools/art-pipeline/AGENTS.md`
