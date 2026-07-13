# Extract the copy-pasted `ctxOf` test helper into the sim harness

**Area:** sim (tests) · **Origin:** pre-release quality audit 2026-07-13 · **Priority:** P3

`function ctxOf(sim)` — build a `SystemContext` from a `Simulation` (`content`/`rng`/`tick`/
`events` + spread-conditional `terrain`) — is copy-pasted into **32 files** under
`packages/sim/test/` (grep `function ctxOf`). That violates the project's own
deduplicate-at-the-second-caller rule 32 times over; the copies differ only in whether they
annotate the return type. `src/harness/` is the established home for exactly this kind of helper
(`scenario.ts`, `populate.ts`, `invariants.ts`).

## Scope

1. Add `ctxOf(sim: Simulation): SystemContext` to the harness (either `harness/scenario.ts` if it
   fits that module's concern, or a small `harness/context.ts`), exported through the existing
   harness surface the tests import from. Keep the `exactOptionalPropertyTypes`-safe
   spread-conditional `terrain` shape.
2. Migrate all 32 test files to the shared helper; delete the local copies. Mechanical — a copy
   with a real divergence (if any turns up) keeps its local variant with a comment saying why.
3. While in there: `test/core/determinism.test.ts` stubs content as `{} as never` — if the shared
   helper makes a cleaner stub trivial, take it; don't force it.

## Verify

`npm test` (sim suite, goldens unmoved — test-only change), `npm run check`.

## Source basis

Test hygiene only; no production or behavior change.
