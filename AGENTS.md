# AGENTS.md — agent guide for Vinland

You are working on **Vinland**, a TypeScript rebuild of *Cultures - 8th Wonder of the World*.
This file is the canonical agent contract. Read it before editing.

Tool-specific files such as `CLAUDE.md` and `GEMINI.md` are compatibility shims that import this
file. Keep durable project rules here or in package-local `AGENTS.md` files, not in client-specific
config or growing process ledgers.

## Where Things Are

This repo (`vinland/`) normally sits beside two read-only reference folders:

- `OpenVikings_reversing/` — C#/.NET reverse engineering of original file formats. Use it as an
  oracle for layouts and decoders, not as architecture to port.
- `Cultures 8th Wonder/` — the original game plus the `culturesnation` mod (`DataCnmd/`). It is the
  asset-pipeline input. Never commit its assets, decoded content, or binaries.

Legal guardrails: Vinland is an independent clean-room GPL-3.0-or-later rebuild. Do not copy original
assets into the repo, do not port OpenVikings source, and do not brand this project with the
original's names, logos, or screenshots. The canonical legal wording is in `docs/SOURCES.md`.

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
   present; base-game plaintext `.ini` files are still better than encrypted `.cif`; OpenVikings is
   the format oracle.
5. **Faithful first, with named approximations.** Tests prove self-consistency, not that a mechanic
   matches the original. For mechanics, extraction, timings, visuals, and constants, state the source
   basis: extracted data, readable source semantics, OpenVikings format evidence, or observed original
   behavior. If something is approximated, name what and why in the code comment, test, commit, or plan
   progress note. Do not create a new running ledger.
6. **RTS scale is a budget.** Per-tick sim cost scales with active work, never entities squared.
   Per-frame render cost scales with the screen, never the whole map.
7. **Keep context lean.** `docs/plans/` are the live planning surface. Durable rules graduate to this
   file or package-local `AGENTS.md`. Completed history, exploratory notes, and long verification
   trails belong in git history or short plan progress notes, not always-read docs.

## Commands

```bash
npm install
npm run build
npm test
npm test -- scenario
npm run test:watch
npm run check
npm run check:fix
npm run scan:structure
npm run pipeline -- --game "../Cultures 8th Wonder" --mod DataCnmd --out content
npm run dev
```

Biome handles formatting/linting, Vitest handles tests, and CI runs check + typecheck + test. The sim
hygiene test rejects nondeterministic globals in `packages/sim`.

## Plan-Driven Workflow

- Plans live in `docs/plans/`. The user chooses the next step and invokes the worktree workflow
  manually for that step.
- `/worktree` is the primary agentic workflow: create an isolated git worktree, execute only the
  requested plan step, verify, review, update the plan progress note, wait for explicit user approval,
  then fast-forward merge.
- A merged step's prompt block is deleted from its plan in the same branch; the ticked checkbox and a
  compact progress note are the surviving state (the checkbox is the only status marker).
- Do not revive old global planning, fidelity, lessons, or tech-debt ledgers. If future work is worth
  tracking, add or update a concrete plan step under `docs/plans/` or use an external issue.
- If a plan's research note is wrong, update the plan with the corrected fact and source basis rather
  than propagating the stale claim.

## Verification

1. Prove code at the lowest useful level: unit, integration, headless scenario, then app scene.
2. Run the matching gates. For normal code, expect `npm test`, `npm run check`, and `npm run build`.
3. Pipeline or schema changes need a real pipeline run against the owned game copy.
4. Golden hashes only move for intentional behavior changes. A moved golden during a refactor means
   behavior changed.
5. Visual or audio correctness needs a human. Agents can check no crashes, data decisions, screenshots,
   and obvious breakage; they cannot self-sign pixels or sound.
6. Player-visible mechanics should have an acceptance scene under `packages/app/src/scenes/`, with a
   headless assertion and a browser checklist.

## Durable Gotchas

- Component stores are module-level singletons. Any test or harness that builds more than one sim in a
  process must clear the whole component namespace, not a hand-picked subset.
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
  row step, elevation lift about 1.24 native px/unit, and pre-lift depth sorting.
- The original game has no automatic sim oracle in OpenVikings. When behavior is not data-pinned,
  prefer a small named approximation over a hidden magic constant.

## Per-Package Contracts

Load these only when working in that area:

- `packages/sim/AGENTS.md` — deterministic sim rules, fixed-point details, golden discipline, scaling.
- `packages/render/AGENTS.md` — screen-bounded Pixi rendering and visual verification.
- `packages/app/AGENTS.md` — URL entries, real-content loading, acceptance scenes.
- `tools/asset-pipeline/AGENTS.md` — extraction, decoder provenance, source/oracle discipline.

## Docs

Start with `docs/README.md`. The core design docs are:

- `docs/ARCHITECTURE.md`
- `docs/ECS.md`
- `docs/DATA-FORMAT.md`
- `docs/TESTING.md`
- `docs/SCENES.md`
- `docs/SOURCES.md`

`docs/plans/` contains live user-authored implementation plans. Keep them concise enough for the next
agent to continue the work without reading old transcripts.
