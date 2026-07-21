# Run sim invariants on a cadence in diag mode and log violations

**Area:** app · **Priority:** P3

`Simulation.checkInvariants()` (`packages/sim/src/harness/invariants.ts` — stock non-negativity,
cache coherence, `CORE_INVARIANTS`) currently runs only in tests. At runtime, state corruption
surfaces long after the corrupting tick — as a weird settler or a crash — and the diagnostics
bundle records the symptom, not the moment. Running the invariants live on a cadence turns the
bundle into "state went bad at tick N" evidence.

## Scope

1. When the diag session records hashes (`?debug=diag`, the existing gate in `diag/session.ts`),
   also run `sim.checkInvariants()` on the same `HASH_TRACE_EVERY_TICKS` cadence (or a separate,
   slower named cadence if measured cost demands — `verifyCaches` re-derives every cache, so
   measure first on a big decoded map).
2. Violations log to a `sim` channel at `error` level (tick + violation strings) — they land in the
   console and every bundle. Do not raise the crash banner: diagnostics mode remains observational.
3. Strictly observational: read-only checks, no sim mutation, goldens untouched.

## Verify

- Unit test: a fixture violating an invariant (e.g. forced negative stock via a test seam) logs the
  violation with its tick; a healthy run logs nothing.
- `npm test`, `npm run check`, `npm run build`.
- Manual: `?scene=sandbox&debug=diag` runs without violation spam; cost visible in the perf overlay
  stays negligible.
