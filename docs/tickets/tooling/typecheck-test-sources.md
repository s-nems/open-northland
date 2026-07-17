# Typecheck the test sources (35 real errors are hiding today)

**Area:** tooling (all packages) · **Origin:** /refactor-cleanup on packages/render, 2026-07-17 · **Priority:** P2

No package's `tsconfig.json` includes `test/**` — every one is `"include": ["src/**/*.ts"]`, and there
is no test tsconfig anywhere in the monorepo. `npm run typecheck` (`tsc --build`) therefore never sees
a test file, so `npm test` is the only thing standing between a test and nonsense. Vitest transpiles
without typechecking, so a test can construct an invalid object, index past an array, or pass the
wrong type entirely and still go green.

Measured 2026-07-17 by pointing `tsc --noEmit` at `packages/render/test/**` + `packages/sim/test/**`:
**35 errors** (31 render, 4 sim). Most are `noUncheckedIndexedAccess` (`boxes[1].x`) and wrong-typed
fixtures (`number` not assignable to `Entity`; `{col,row,buildingType}` is not a `PlacementGhost`;
`TerrainMap` missing `resolution`).

This is not hypothetical. The render pass found `test/world-renderer.test.ts` building a `MotionTrack`
without its required `gaitPhase`, so `trackMotion`'s `m.gaitPhase += rate * dt` ran `NaN` through the
whole suite while it passed — it only ever read `drawX`/`drawY`. That one is fixed (the suite now
lives in `test/sprite-pool/motion.test.ts` with a correct fixture), but nothing stops the next one.

## Scope

Add test typechecking and fix what it surfaces:

- A `tsconfig.test.json` per package (or one root `tsconfig.tests.json`) covering `test/**/*.ts` with
  `noEmit: true`, referencing the package's own `src` project. Follow the existing project-reference
  shape in each `tsconfig.json`.
- Wire it into `npm run typecheck` so CI fails on a test type error.
- Fix the 35 errors. **Fix the types, never the assertions** — an error means the fixture is wrong, so
  correct the fixture; do not loosen an `expect` or cast an error away to get green. If an error
  reveals a test was proving nothing (the `gaitPhase` shape), say so in the commit.
- Grep for other packages' test trees while there (`app`, `audio`, `desktop`, `tools/asset-pipeline`)
  — the gap is monorepo-wide, and the count above only covers render + sim.

## Verify

`npm run typecheck` (now covering tests), `npm test`, `npm run check`. No golden moves — this is a
type-level change. A test that starts failing once typechecked is a real find: report it, don't
silence it.
