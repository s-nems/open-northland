# CLAUDE.md — agent guide for Vinland

You are working on **Vinland**, a TypeScript rebuild of *Cultures – 8th Wonder of the World*.
This file is the contract. Read it fully before editing.

## Where things are

The agent is typically launched from `~/Projects/vikings/` (the parent), which contains three
sibling folders — you have read access to all of them:

- `vinland/` — **this project** (the only one you write to).
- `OpenVikings_reversing/` — C#/.NET binary-faithful reverse engineering of the original engine.
  **Reference only.** Use it to learn the original file formats (it already decodes `.bmd`,
  `.lib`, palettes, `.pcx`, fonts). Do not port its architecture — its goal (binary fidelity) is
  the opposite of ours. Format → source-file map is in `docs/SOURCES.md`.
- `Cultures 8th Wonder/` — the **original game + the `culturesnation` mod** (`DataCnmd/`). This is
  copyrighted; it is the *input* to the asset pipeline. Never copy its assets into this repo.

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

## Commands

```bash
npm install            # workspaces
npm run build          # tsc across packages
npm test               # vitest, headless sim
npm run pipeline -- --game "../Cultures 8th Wonder" --mod DataCnmd --out content
npm run dev            # vite app
```

## Conventions

- **Language of code & docs: English** (tooling/agent ergonomics). User communication: Polish is fine.
- **TypeScript strict.** No `any` in `sim`/`data`. Explicit return types on exported functions.
- **Commits: Conventional Commits, imperative, capitalized, no AI attribution.** No scope here
  (this is not a `~/Projects/yonder` repo). E.g. `feat: Add fixed-point pathfinding grid`.
- Keep new code in the style of the file around it.

## How to verify your work

- Mechanics change → add/extend a headless test in `packages/sim/test` and run `npm test`.
- Don't claim something works because it typechecks. Run it. Golden determinism tests must stay green.
- Rendering/visual change → that needs the app running; say so rather than asserting it works.

## Start here

`docs/ARCHITECTURE.md` → `docs/ECS.md` → `docs/DATA-FORMAT.md` → `docs/ROADMAP.md`.
The roadmap names the current target slice; do the smallest next step toward it.
