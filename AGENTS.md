# AGENTS.md — agent guide for OpenNorthland

You are working on **OpenNorthland**, a TypeScript rebuild of *Cultures - 8th Wonder of the World*.
This file is the canonical agent contract. Read it before editing.

Tool-specific files such as `CLAUDE.md` and `GEMINI.md` are compatibility shims that import this
file. Keep durable project rules here or in package-local `AGENTS.md` files, not in client-specific
config or growing process ledgers.

## Where Things Are

This repo (`open-northland/`) normally sits beside a read-only copy of *Cultures - 8th Wonder of
the World* and the `culturesnation` mod (`DataCnmd/`). That installation is the asset-pipeline
input. Never commit its assets, decoded content, or binaries.

Legal guardrails: OpenNorthland is an independent GPL-3.0-or-later implementation. Do not copy
original assets into the repo or use the original game's names, logos, or screenshots as project
branding. Screenshots of OpenNorthland's renderer drawing locally decoded assets are fine; the
README hero image is one. The canonical legal wording is in `docs/LEGAL.md`.

## Golden Rules

1. **The `sim` package is deterministic and pure.** No `Math.random`, `Date.now`, DOM, I/O, Pixi,
   `render`, or `app` imports. Randomness comes only from the seeded RNG. Same seed + same inputs must
   produce byte-identical state.
2. **Sim state uses fixed-point integers.** Rendering interpolates floats; the sim never accumulates
   float state. Mint `Fixed` only through `fx.*`.
3. **Content is data, not code.** Buildings, jobs, goods, weapons, tribes, graphics bindings, and
   balance live in the validated IR under `content/`; systems consume data instead of hardcoding
   special cases.
4. **Prefer readable original sources.** The mod's `.ini` files under `DataCnmd/` are preferred when
   present; base-game plaintext `.ini` files are still better than encrypted `.cif`. For binary
   formats, document byte-level evidence from files in the owned game copy and pin it in synthetic
   tests.
5. **Faithful first, with named approximations.** Tests prove self-consistency, not that a mechanic
   matches the original. For mechanics, extraction, timings, visuals, and constants, state the source
   basis: extracted data, readable source semantics, byte-level format evidence, a published
   standard, or observed original behavior. If something is approximated, name what and why in the code comment, test, commit, or
   ticket. Do not create a new running ledger.
6. **RTS scale is a budget.** Per-tick sim cost scales with active work, never entities squared.
   Per-frame render cost scales with the screen, never the whole map.
7. **Keep context lean.** `docs/tickets/` is the live work tracker (one self-contained task per
   file). Durable rules graduate to this file or package-local `AGENTS.md`. Completed history,
   exploratory notes, and long verification trails belong in git history, not always-read docs.

## Code Organization & Quality

Write to these directly; the review agents enforce them.

- **Readability first.** Code must be understandable quickly without the PR context. Names carry
  domain meaning; comments explain units, invariants, and source basis — never restate the code.
- **Comments are budgeted prose.** The *content* rule above sets what a comment may say; this one
  sets how much. One tight sentence per fact; a typical doc comment is 1–3 sentences, and a source
  basis is a short parenthetical, not a paragraph. Longer is fine only when every extra sentence
  carries a distinct fact the reader needs. No rhetorical emphasis (CAPS/bold mid-sentence,
  superlatives, "the trap"/"the gem" narration), no history of how the code got here (git has it),
  no quotes from the conversation or review that produced the code, no restating the same invariant
  in a second paragraph. When editing a file, trimming an overgrown comment to its load-bearing
  facts is boy-scout work.
- **Group by feature, not flat.** When a module passes ~300 lines or mixes concerns, split it by
  concern into a feature subfolder with an `index.ts` barrel that keeps import paths stable. Prefer
  deepening the tree over widening a flat directory; group by feature (`hud/tool-panel/`), not by
  kind (`utils/`, `helpers/`).
- **Delete dead code.** Unused exports, commented-out blocks, and leftover shims go; git history is
  the archive.
- **Deduplicate at the second real caller.** Accidental copy-paste is a defect — and so is an
  abstraction added before a second caller exists.
- **Boy-scout rule.** Leave code the change touches cleaner than found: fix a misleading name,
  delete dead weight, split what you are already editing. Scope it to the code the step passes
  through — do not turn a step into a rewrite.
- **Modern TypeScript.** Strict mode is on; keep it meaningful: no `any` (use `unknown` plus
  narrowing), model alternatives as discriminated unions with exhaustive `switch` (a `never` check)
  rather than boolean flags, prefer string-literal unions and `as const` tables over `enum`, mark
  data not meant to mutate `readonly`, use `import type` for type-only imports, and avoid non-null
  assertions — prove the invariant or handle the absent case.

## Commands

```bash
npm install
npm run build
npm test
npm test -- scenario
npm run test:watch
npm run test:content
npm run test:pipeline
npm run check
npm run check:fix
npm run scan:structure
npm run pipeline -- --game "../Cultures 8th Wonder" --mod DataCnmd --out content
npm run dev
```

Biome handles formatting/linting, Vitest handles tests, and CI runs check + typecheck + test. The sim
hygiene test rejects nondeterministic globals in `packages/sim`.

## Ticket-Driven Workflow

- Work items are tickets under `docs/tickets/` — `features/` for player-visible slices, area
  folders (`sim/`, `render/`, `app/`, `pipeline/`, …) for scoped technical work; one file, one
  self-contained task (see `docs/tickets/README.md`). The user chooses the next one and invokes the
  worktree workflow manually.
- `/worktree` is the primary agentic workflow: create an isolated git worktree, execute only the
  requested task, verify, review, update the tracker, wait for explicit user approval, then
  fast-forward merge.
- A completed ticket is **deleted in the completing commit** (git history is the archive); a
  partially-done one is rewritten to exactly the remaining work.
- **Every workflow feeds the tracker, not just `/worktree`.** Real work discovered but deliberately
  not done now — review findings left out of a merge, refactor findings dropped as out of scope,
  ideas noted mid-task — is **filed as a self-contained ticket before the session ends** (on the
  executing branch when there is one), never just named in a report. `/ticket-scout` is the
  proactive sweep that scans a scope for ticket candidates and files them.
- If a ticket's research note is wrong, update it with the corrected fact and source basis rather
  than propagating the stale claim.

## Verification

1. Prove code at the lowest useful level: unit, integration, headless scenario, then app scene.
2. Run the matching gates. For normal code, expect `npm test`, `npm run check`, and `npm run build`.
3. Pipeline or schema changes need a real pipeline run against the owned game copy —
   `npm run test:pipeline` is that gate as a command (fresh run into a throwaway dir, validated by
   the real-content suite). Changes consuming real content (loaders, id joins, merge overlays) get
   `npm run test:content` when local `content/` exists. Both are local-only; CI never runs them
   (docs/TESTING.md "Real-content test modes").
4. Golden hashes only move for intentional behavior changes. A moved golden during a refactor means
   behavior changed.
5. Visual or audio correctness needs a human. Agents can check no crashes, data decisions, screenshots,
   and obvious breakage; they cannot self-sign pixels or sound.
6. Player-visible mechanics should have an acceptance scene under `packages/app/src/scenes/`, with a
   headless assertion, localized menu description, and a human browser pass. Acceptance notes belong in
   the ticket or test, not in an in-scene checklist panel.

## Durable Gotchas

- Component stores are owned by the `World`, so `new Simulation()`/`new World()` is a complete reset;
  many sims can live in one process independently, with no store-clearing ritual.
- Canonicalize only decisions whose result depends on which entity wins. Membership checks and
  commutative sums do not need sorting; picks and first-found mutations do.
- Before extracting data, grep the real source file, the extractor, and generated `ir.json`. Do not
  trust schema names, fixtures, or plan prose as proof.
- `.ini` keys are case-sensitive and list shapes differ: repeated single-value keys and one-line
  multi-value keys need different helpers.
- Numeric ids are often scoped. Check the real key space before indexing by `id` or validating a
  cross-reference.
- Decoded maps already store final ground-pattern choices in their ground lanes; do not reinvent a
  terrain transition algorithm for imported maps.
- The current map projection is observed from the original: staggered raster, 68 px cell width, 38 px
  row step, elevation lift `TILE_HALF_H/32` (1.1875 native px/unit), and pre-lift depth sorting.
- The sim's logic grid is the original's HALF-CELL lattice (`2W×2H`; cell `(c,r)` = node
  `(2c+(r&1), 2r)`). Every integer grid coordinate in sim commands, footprints, and nav is a
  half-cell node; fixed-point Positions stay fractional visual-tile coords (`nav/halfcell.ts` is the
  one conversion seam). Cell-resolution grids must pass through `halfCellMapFromCells` before
  reaching a `TerrainGraph`.

## Per-Package Contracts

Load these only when working in that area:

- `packages/sim/AGENTS.md` — deterministic sim rules, fixed-point details, golden discipline, scaling.
- `packages/render/AGENTS.md` — screen-bounded Pixi rendering and visual verification.
- `packages/audio/AGENTS.md` — pure-decision/Web-Audio split, sink-only sim boundary, human-ear verification.
- `packages/app/AGENTS.md` — URL entries, real-content loading, acceptance scenes.
- `tools/asset-pipeline/AGENTS.md` — extraction, decoder provenance, and source discipline.

## Docs

Start with `docs/README.md`. The core design docs are:

- `docs/ARCHITECTURE.md`
- `docs/ECS.md`
- `docs/DATA-FORMAT.md`
- `docs/TESTING.md`
- `docs/SCENES.md`
- `docs/SOURCES.md`
- `docs/LEGAL.md`

`docs/tickets/` holds the open work items — keep each ticket concise enough for the next agent to
continue the work without reading old transcripts.
