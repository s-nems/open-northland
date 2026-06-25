# CLAUDE.md — agent guide for Vinland

You are working on **Vinland**, a TypeScript rebuild of *Cultures – 8th Wonder of the World*.
This file is the contract. Read it fully before editing.

## Where things are

This repo (`vinland/`) is normally checked out inside a **workspace parent directory** and, when
present locally, sits alongside two sibling reference folders — all read-only to you; this repo is
the only thing you write to:

- `vinland/` — **this project** (the only one you write to).
- `OpenVikings_reversing/` — C#/.NET binary-faithful reverse engineering of the original engine.
  **Reference only.** Use it to learn the original file formats (it already decodes `.bmd`,
  `.lib`, palettes, `.pcx`, fonts). Do not port its architecture — its goal (binary fidelity) is
  the opposite of ours. Format → source-file map is in `docs/SOURCES.md`.
- `Cultures 8th Wonder/` — the **original game + the `culturesnation` mod** (`DataCnmd/`). This is
  copyrighted; it is the *input* to the asset pipeline. Never copy its assets into this repo.

**Legal guardrails (an agent must uphold these too):** this is an independent, clean-room
reimplementation under **GPL-3.0** (see `LICENSE`). (a) Never commit original assets, decoded
content, or binaries — `content/` is gitignored and tests use the synthetic fixture, not real game
data (see `docs/TESTING.md`). (b) `OpenVikings_reversing/` is **format documentation**, not code to
port — take facts about file layouts, never its source/architecture. (c) Don't brand the project
with the original's names or logos: it's *Vinland*, an unaffiliated rebuild — no "Cultures"
branding, no original logos/screenshots in README or promo copy. The canonical statement lives in
`README.md` **Legal** and `docs/SOURCES.md`; keep them in sync if you touch licensing wording.

## Golden rules

1. **The `sim` package is deterministic and pure.** No `Math.random`, no `Date.now`, no `Date`,
   no DOM, no I/O, no `import` from `render`/`app`/Pixi. Randomness comes only from the injected
   seeded RNG (`packages/sim/src/rng.ts`). Two runs from the same seed + same inputs must produce
   byte-identical state. This is what makes mechanics testable headless and multiplayer-lockstep
   possible later. If you break determinism, the golden tests in `packages/sim/test` will fail —
   keep them green.
2. **Sim positions are fixed-point integers**, not floats (`packages/sim/src/fixed.ts`). Rendering
   interpolates to smooth floats; the sim never does. Floats are allowed only in `render`/`app`.
3. **Content is data, not code.** Game rules (buildings, jobs, goods, weapons, tribes) live in the
   intermediate format under `content/`, validated by the zod schemas in `packages/data`. To
   change balance, change data, not systems. See `docs/DATA-FORMAT.md`.
4. **Prefer the mod's `.ini` sources.** Many base-game rules are encrypted `.cif`; the
   `culturesnation` mod ships readable `.ini` equivalents under `DataCnmd/`. Prefer those.
5. **Dependencies are minimal and readable.** Custom tiny ECS over heavy ECS libs (determinism +
   legibility). Pixi only inside `render`. Zod for schemas. Vitest for tests. Don't add a
   dependency without a reason recorded in the PR/commit.
6. **Faithful first; deviations are deferred and recorded, never default.** The goal is a faithful
   rebuild that can *then* be modded — a mechanic must match the original's behavior, pinned to the
   extracted data params, the mod's `.ini` semantics, or observation of the running original. `npm
   test` proves the sim is self-consistent and deterministic; **`docs/FIDELITY.md` is where we track
   whether it is *faithful*** — a different axis no test covers (OpenVikings' sim is a stub, so
   mechanics have no automatic oracle). Log any conscious divergence in `docs/FIDELITY.md`; never
   bake it in silently.

## Commands

```bash
npm install            # workspaces
npm run build          # tsc across packages
npm test               # vitest: unit + integration + e2e + determinism-hygiene
npm test -- scenario   # run one file/suite by name substring (fast inner loop)
npm run test:watch     # vitest watch mode
npm run check          # biome lint + format check (CI runs this)
npm run check:fix      # biome autofix + format
npm run pipeline -- --game "../Cultures 8th Wonder" --mod DataCnmd --out content
npm run dev            # vite app
```

Tooling: **Biome** (format + lint, config in `biome.json`) and **vitest**; CI (`.github/workflows/ci.yml`)
runs check + typecheck + test on every push/PR. A source-hygiene test (`packages/sim/test/hygiene.test.ts`)
fails the build if a nondeterministic global leaks into `sim` — the determinism rules are enforced, not just documented.

## Conventions

- **Language of code & docs: English** (tooling/agent ergonomics). User communication: Polish is fine.
- **TypeScript strict.** No `any` in `sim`/`data`. Explicit return types on exported functions.
- **Commits: Conventional Commits, imperative, capitalized, no AI attribution.** No scope here
  (this is not a `~/Projects/yonder` repo). E.g. `feat: Add fixed-point pathfinding grid`.
- Keep new code in the style of the file around it.

## How to verify your work (the self-validation loop)

The sim is deterministic and headless **so that you can check your own work** by running `npm test`
and reading pass/fail — at the unit, integration, and game-level (e2e) layers. Read
`docs/TESTING.md`; the pyramid is real and the harness exists (`scenario()`, `invariants.ts`,
the synthetic `testContent()` fixture). The loop:

1. Write/extend the test at the **lowest level** that proves the change (unit → integration →
   headless scenario). Mechanics change → a test in `packages/sim/test`.
2. Run `npm test`. If an invariant fired, it reports the **exact tick** — use that.
3. Don't claim something works because it typechecks. **Run it.** Golden state + atomic-trace tests
   must stay green; only update a golden if the change was intentional, and say which mechanic.
4. Rendering/visual change → an agent CANNOT self-judge pixels. Run the screenshot diff if present,
   otherwise say it needs a human. Validate decoded assets against the **OpenVikings oracle**.

## Per-package contracts (load on demand)

The strict rules live next to the code they bind, so they load only when you work there (and keep
this root file lean). Golden rules 1–2 above are the crisp always-on version.

- **`packages/sim/CLAUDE.md`** — the detailed `sim` determinism contract: the forbidden-globals
  anti-patterns (`Math.random`/`Date.now`/… → `world.rng`), canonical `Map`/`Set` iteration, the
  fixed-point + branded-type rules, and the golden-update discipline. The hygiene test enforces it.
- **`tools/asset-pipeline/CLAUDE.md`** — pipeline-only notes: prefer the mod's `.ini`, validate
  visual decoders against the OpenVikings oracle, never commit decoded/copyrighted bytes.

## Modern conventions baked in (follow them)

- **Branded types** (`brand.ts`): `Fixed` and `Entity` are nominal — a raw `number` won't assign.
  Mint `Fixed` only via `fx.*`. Add brands for new semantic ids rather than passing bare `number`.
- **Discriminated unions** for commands/atomic-effects/events (`commands.ts`, `events.ts`), with
  `assertNever` in every `switch` so adding a variant is a compile error until handled. Don't use
  numeric opcodes for control flow — keep numeric ids only as the *data* cross-reference.
- **Events, not reach-in**: one-shot things go through `ctx.events` (typed `SimEvent`); `render`
  consumes them. Never let `render` read live component stores, and never deliver events via
  callbacks (that would let a subscriber mutate sim state).
- **Throw for bugs, return for expected failures**: throw on programmer errors (missing component,
  div-by-zero); return a typed result for recoverable boundary failures (bad content/mod).

## Start here

`docs/ARCHITECTURE.md` → `docs/ECS.md` → `docs/DATA-FORMAT.md` → `docs/TESTING.md` → `docs/FIDELITY.md` → `docs/ROADMAP.md`.
The roadmap names the current target slice; do the smallest next step toward it. `docs/FIDELITY.md`
names whether that slice is *faithful* — the goal tests can't see.
