# A lone farmer falls ~25% short of the per-farmer rate a bigger crew reaches

**Area:** sim · **Origin:** farm pacing calibration review, 2026-07-20 · **Priority:** P2

The original was measured at a straight-line ladder: 1 farmer ≈ 10 grain per 10 minutes of ×1 game
time, 2 ≈ 20, 3 ≈ 30, 4 ≈ 40. OpenNorthland does not reproduce the first rung.

Measured by `packages/app/test/farm-pacing.test.ts` (idealized: flat grass, a sink that never fills,
needs off, 7200-tick warmup then a 7200-tick window):

| crew | grain / 10 min | per farmer | target |
|------|----------------|------------|--------|
| 1 | 9  | 9.0  | 10 |
| 2 | 25 | 12.5 | 10 |
| 3 | 37 | 12.3 | 10 |
| 4 | 46 | 11.5 | 10 |

Crews 2-4 are linear in each other and ~20% high (the harness never throttles a farmer). The lone
farmer is the anomaly: it is ~25% below its own colleagues' per-head rate, so the curve bends at the
bottom instead of running straight.

## Why

`FARM_MAX_FIELDS = 24` with per-stage watering: every growth stage consumes a watering, so a plot of
24 needs 24 waterings per stage. One farmer cannot walk that circuit inside one
`WHEAT_TICKS_PER_STAGE` window, so its fields spend part of each stage standing thirsty — growth,
not labor, binds at crew 1. Add a second farmer and the circuit closes, which is why the rate jumps
rather than doubling smoothly.

This surfaced only after the `coordHash` avalanche fix (same commit): the un-mixed hash could reach
just the fast half of the growth band, so fields grew ~12% quicker than nominal and masked the
shortfall. The earlier reported ladder (12/24/36/47) was that artifact.

## Scope

Land the lone farmer near 10 without pushing crews 2-4 further above it, and without shrinking the
plot (24-25 standing plants at any crew size is measured in the original and must hold). Candidate
levers, none yet evaluated:

- Lower `WHEAT_TICKS_PER_STAGE` so a lone farmer's watering circuit fits inside a stage — but this
  also speeds crews 2-4, which are already high.
- Let one watering fuel more than one stage step (a watering budget rather than a per-stage gate).
  Changes the mechanic, so it needs a source basis, not just a better curve.
- Re-check `workRepeats` against the original once
  docs/tickets/sim/job-repeat-counter-extraction.md wires the extracted value in; the whole ladder
  scales with it.

Whichever lever is chosen, the ~20% overshoot on crews 2-4 is partly harness idealization — measure
in a real settlement scene (hunger, sleep, hauling contention) before tuning against the headless
number alone.

## Verify

- `packages/app/test/farm-pacing.test.ts`: tighten the per-farmer band and add a superlinearity guard
  (`rateOf(4) / rateOf(1) < 1.2`) once the ladder is straight — today it would fail at ~1.28.
- The plot assertions (peak `FARM_MAX_FIELDS`, mean > 20, pctFull > 75) must stay green.
- A human pass on `?scene=chain`: the plot still ripens continuously, never stripping bare.
