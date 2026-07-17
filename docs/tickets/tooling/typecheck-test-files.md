# Type-check the test files

**Area:** tooling (tsconfig + the typecheck gate) · **Origin:** /refactor-cleanup on packages/app,
2026-07-17 · **Priority:** P3

No test file in this repo is type-checked. Every package tsconfig scopes itself to sources — e.g.
`packages/app/tsconfig.json` is `"include": ["src/**/*.ts"]` — and the root `tsconfig.json` is a
`files: []` solution over package references, so `npm run typecheck` (`tsc --build`) never visits
`test/`. Vitest transpiles without checking. CI runs check + typecheck + test and still sees nothing.

Proof it costs: `packages/app/test/tool-panel-controllers.test.ts` carried an `id:` field on its
`MenuBuildingEntry` literals that the type has never had (a TS2353 excess-property error, had anything
looked). This branch removed it, but nothing would catch the next one — and the sibling
`packages/app/test/building-menu.test.ts` had the same literal *right*, so the two had silently
drifted apart with no gate to notice.

Repo-wide, not app-only: `packages/{sim,render,audio,data,desktop}` and `tools/asset-pipeline` all have
the same shape.

**Source basis:** structural/tooling; no mechanic or visual involved.

## Scope

- Give each package a test-inclusive type-check — either a `tsconfig.test.json` per package (extending
  the package config, `include: ["src/**/*.ts", "test/**/*.ts"]`, `noEmit: true`) referenced from the
  root solution, or widen the existing `include` and keep `rootDir`/`outDir` emit correct (the app,
  sim, render, data and desktop configs emit, so a naive include widening would emit tests into
  `dist/` — that is the trap to avoid).
- Wire it into `npm run typecheck` so CI enforces it.
- Fix whatever the first run surfaces. Expect a batch: nothing has ever checked these files. If the
  fallout is large, land the config with the errors triaged into a follow-up ticket rather than
  loosening `strict`.

## Verify

`npm run typecheck` covers `test/**` in every package (prove it: introduce a deliberate type error in
one test file, see it fail, revert). `npm test`, `npm run check`, `npm run build` stay green, and
`dist/` gains no test output.
