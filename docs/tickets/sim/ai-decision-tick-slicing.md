# Bound one AI seat's decision pass

**Area:** sim · **Focus:** ai-player · **Priority:** P2
**Needs user:** splitting a seat's modules across ticks moves when their commands land

A due seat runs all five strategic modules in one tick (`runAiPlayerModules`, `ai-player/index.ts`;
seat `p` is due when `tick % AI_DECISION_INTERVAL_TICKS === p % 24`), so with 13 seats 13 of every 24
ticks carry one full pass. On `magiczny_las_12_players` with 13 AI seats, an instrumented replay from
the 40k, 50k and 60k checkpoints (busy machine, so the ms are suspect) timed seat passes at a 1.0-1.2 ms
median, a 2.6-3.1 ms p95 and warm worst passes of 4-5 ms.

The stalled placement search behind most of those spikes now retries every
`STALLED_PLACEMENT_RETRY_DECISIONS` decisions, and its occupied-anchor test is numeric. What remains
is the workforce module (`collectResources`, mean 0.8-0.9 ms, peaks 4 ms in the same replay):
`upkeepHolders` 15-18% of `aiPlayer`, `allocateScout` -> `nextSignpostTarget` 6-11% (it refloods
route-region pockets, which construction progress no longer drops; re-measure), generic collector
allocation 8-10%.

## Scope

- Measure first: on an idle box, `ON_BENCH_CHECKPOINT=<40k checkpoint> ON_BENCH_TICKS=4000
  npm run bench:map` with the session env from `docs/DEVELOPMENT.md` (Measuring performance), trust
  clean. If `aiPlayer` p95 and max are within about 2 ms, delete this ticket.
- Otherwise cut the workforce module's per-decision cost without changing its answers (state hash
  unchanged), starting with `upkeepHolders` and the generic collector allocation.
- Only if warm passes still exceed about 2 ms after that, and with the user's decision: spread one
  seat's modules across consecutive ticks (module slot derived from tick and seat). This moves when
  each module's commands land and changes state hashes. Modules communicate only through commands
  applied next tick; show that the module pairs sharing a tick today do not couple before splitting.

## Verify

- `bench:map` before and after on an idle box, then `npm run bench:compare`: `aiPlayer` p95 and max
  fall toward the median. A workforce-only change keeps the state hash.
- `npm test`, `npm run check`, `npm run build`.
