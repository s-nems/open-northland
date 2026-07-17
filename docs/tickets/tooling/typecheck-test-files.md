# Typecheck the test suites

**Area:** tooling · **Origin:** sim refactor-cleanup (a real bug it let through), 2026-07-17 · **Priority:** P2

## Context

No tsconfig includes `packages/*/test/**`, so **test files are never typechecked** — `npm run build`,
`tsc --noEmit -p packages/sim/tsconfig.json` and CI all skip them. Vitest transpiles per file without
type errors, so a test that no longer type-checks still runs.

This is not hypothetical. During the sim refactor-cleanup, removing `Scenario`'s dead
`number | ScenarioOptions` constructor overload left `test/core/scenario.test.ts` calling
`scenario(testContent(), 42)`. Nothing failed: `42` destructured against `{ seed = 1, map }`, so a
1000-tick invariant test silently ran at **seed 1 instead of 42** — a green test proving less than it
claimed. A typechecked suite would have caught it at the edit.

The same gap means every fixture's shape is unverified against the types it fakes, which is exactly where
a `as unknown as` or a stale literal hides.

## Scope

- Add a tsconfig that covers `packages/*/test/**` and `tools/*/test/**` (either extend each package's
  config with a `tsconfig.test.json`, or widen `include` where that does not pollute the build output —
  the emitted `dist/` must not gain test files).
- Wire it into `npm run check` / CI so a type error in a test fails the gate.
- Fix the fallout the first run surfaces. Expect some: the suites have never been checked.

## Done when

- A deliberately wrong call in a test (e.g. passing a number where an options object is required) fails
  the local gate and CI.
- `dist/` output is unchanged.
