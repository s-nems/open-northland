# Give the farm-pacing measurement an explicit timeout

**Area:** app (test) · **Priority:** P3

`packages/app/test/farm-pacing.test.ts` runs four 14 400-tick simulations (`CREWS = [1, 2, 3, 4]`,
memoized through `runOf`) against vitest's default 5 s `testTimeout`. In isolation the whole file
takes ~2 s of test time, but under a loaded full `npm test` the first `it` — the one that forces all
four runs through `rateOf` — has been observed failing with `Test timed out in 5000ms` at 9.5 s and
13.4 s. The suite passes on a quiet machine, so this reads as an intermittent red gate rather than a
real regression.

The sim is deterministic, so the measurement itself never varies; only the wall clock does. Nothing
in the file declares a timeout, and no other heavy suite in `packages/app/test/` shares this shape.

## Scope

- Give the `describe` (or the measuring `it`) an explicit timeout sized to the work — the four runs
  are ~2 s of sim on a quiet machine, so the budget needs headroom for a loaded CI worker, not a
  hand-tuned number.
- Check whether the sibling heavy sim suites (`gatherer-stalls`, `map-gatherer-cycle`,
  `resource-harvest-cadence`, `battle-muster`) sit close enough to the same limit to want the same
  treatment, and state the basis for whatever budget is picked.
- Do not widen the pacing bands to make the test pass: the failure is wall-clock, not throughput.

## Verify

`npm test` on a loaded machine (run it alongside another full suite) must stay green across several
consecutive runs. `npm run check`.
