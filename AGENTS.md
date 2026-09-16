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

- Use names, types and focused functions that explain the code without the conversation or PR.
  Group by feature; split mixed responsibilities, not files merely exceeding a line count. Around
  300 lines is a review cue, not a limit for tables, schemas or cohesive implementations.
- Keep ownership explicit. Prefer composition and narrow domain interfaces; do not introduce a
  framework, service layer, wrapper or helper without a concrete caller and a simpler resulting API.
  Share a helper when a second real caller proves the concept. Check existing tools before adding one.
- Delete dead code and commented-out blocks. Improve touched code without expanding a bounded task
  into a repository rewrite. Do not add responsibilities to an already overgrown module.
- Enforce boundaries through packages, types and existing lint/hygiene checks. A bespoke regex scanner
  is not proof of a local refactor; source scans are for otherwise unenforceable repository contracts.
- Use strict TypeScript: no `any`, narrow `unknown`, exhaustive discriminated unions, string-literal
  unions over `enum`, `readonly` for stable data, `import type`, and proven absence handling instead
  of non-null assertions.

### Comments and documentation

- Keep facts with one owner: rules in the nearest contract, usage in the relevant reference, current
  work in a ticket, history in Git. Link to the owner instead of copying its checklist.
- A comment earns its place with a unit, invariant, ownership boundary, non-obvious reason or source
  basis. Omit prose that repeats names, types or control flow; JSDoc is not required for every export.
- Usually state one fact in one to three lines. Longer protocol layouts, security/legal constraints
  and byte evidence are valid exceptions. Otherwise improve structure or put the detail in a test
  or focused reference. Avoid module essays, caller inventories and chains of `{@link}` references.
- Describe the current contract, not dates, authors, conversations, tickets, PRs or revisions. Preserve
  source basis and uncertainty when shortening. Rewrite obsolete comments instead of appending updates.
- When extracting code, count source and destination comments together. Moving prose or adding a header
  to every new module is not an improvement; add prose only for a previously unstated necessary fact.
- Markdown should answer a reader's task with verified facts and runnable examples. Omit repeated
  summaries, generic advice and investigation transcripts. Do not compress format evidence or art
  provenance merely to meet a word budget.

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

Use the current checkout when the user authorizes it; otherwise `/worktree` provides isolation.
Preserve existing changes. Prior authorization to commit or integrate remains valid; do not add
another approval round. Rebase task branches onto current target, then fast-forward; never merge
the target into a task branch or rewrite unrelated history.

## Context and verification

Start with this contract, local workspace instructions, the requested task and relevant package
contracts. Search the owning feature, callers and tests before loading broad references. The
[documentation index](docs/README.md) routes additional reading; do not load the whole ticket backlog,
all package contracts or art source records for an unrelated change.

Use [TESTING.md](docs/TESTING.md) as the single required-check matrix. Run focused tests during
iteration and the applicable gates at completion. Repeat successful gates only after relevant changes;
serialize full suites and benchmarks on a shared machine. Keep full logs outside the conversation
and report failures, counts and missing checks.

Review the complete task diff for correctness, ownership, readability and useful test coverage.
Use the applicable checklists in `.claude/agents/` as review lenses in either client. A separate
reviewer is useful for an independent, risky concern, not mandatory ceremony for every edit. Give any
reviewer a bounded diff, question and required evidence; verify findings before making changes.

Prove behavior at the lowest useful layer: unit, integration, headless scenario, browser.
Golden hashes change only for intentional behavior changes. Player-visible mechanics should have a
registered acceptance scene when it adds useful coverage. Agents inspect screenshots, console errors,
state and integration themselves; final visual/audio acceptance remains human. For environment art,
follow the ×2 world-view trial and door-to-character calibration in `docs/art/WORLD-STYLE.md`.

Commands and local tools: [DEVELOPMENT.md](docs/DEVELOPMENT.md).

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
