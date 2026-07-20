# Re-measure the AI seat's population curve after the growth re-pin

**Area:** packages/sim · **Origin:** engine review of fix/child-growup-time, 2026-07-20 · **Priority:** P3

`packages/sim/src/systems/ai-player/population.ts:70` gates a mother's next child on her previous one
still being a minor (`isMinor`), so childhood duration is the only brake on the AI seat's birth rate.

The growth re-pin cut childhood from 16384 ticks to the measured 2880, shortening the per-mother cycle
from roughly 16.7k to 3.2k ticks — about a 5× faster population doubling in wall-clock. Nothing about
determinism changed and no gate failed, but every "how long until the map is crowded" assumption formed
before this change is now optimistic by that factor, and the per-tick scan in
`docs/tickets/sim/job-system-settler-query.md` will surface proportionally sooner in a long run.

## Scope

Measure rather than assume. Run `npm run bench:sim` and `npm run soak:gatherers` on `main` and record the
settler count over time and the per-system p95 at the new cadence. Compare against the numbers the
existing sim-scaling tickets were written from, and either confirm the headroom still holds or sharpen
those tickets with the real curve.

This is a measurement task; only file follow-up work if the numbers show a budget breach. Do not tune the
growth constants to make a benchmark comfortable — they are pinned to observation of the original
(`packages/sim/src/systems/lifecycle/ageclass.ts`).

## Verify

`npm run bench:sim` (with `ON_BENCH_SETTLEMENTS` turned up for a scaling curve) and
`npm run soak:gatherers`, plus `npm test` if anything is changed as a result.
