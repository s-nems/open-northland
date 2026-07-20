# Extract `baserepeatcounter` for every trade that has one, and model its experience scaling

**Area:** sim · **Origin:** farm pacing calibration, 2026-07-20 · **Priority:** P2

`Data/logic/humanjobexperiencetypes.ini` gives three trades a `baserepeatcounter` — how many strokes a
worker plays per work action, which is what a unit of output costs in labor:

| type | name | job | good | baserepeatcounter |
|------|------|-----|------|-------------------|
| 37 | hunter general | 15 | — | 5 |
| 46 | farmer wheat   | 18 | 4  | 2 |
| 65 | fisher general | 22 | —  | 5 |

Only the farmer's is modelled today, and only for the field loop: it is hand-pinned as
`GoodFarming.workRepeats` in `packages/app/src/catalog/farming.ts` and multiplied into the plant/cultivate/
harvest durations in `packages/sim/src/systems/agents/farming/planner.ts`. It is the dial the farm's whole
throughput rests on — at 2 strokes a farmer banks ~10 grain per 10 minutes, matching the original.

Two gaps:

1. **The hunter and fisher run one stroke per action**, so both are ~5× faster than the original's data
   says. Nobody has measured either against the running game; the farm was measured, they were not.
2. **"base" implies experience scales it.** `experiencefactor` sits in the same records (hunter 200,
   fisher 150, farmer wheat 100) and settlers already carry an `experience` map (`Settler.experience`),
   so a veteran presumably needs fewer strokes than a novice. That relationship is not decoded.

## Scope

- Extract the `[humanjobexperiencetype]` records in the asset pipeline, keyed by `(job, good)` — note the
  `good` key is present only on the farmer record, so the key space is `(job, good?)`; check the real file
  before indexing (durable gotcha: numeric ids are often scoped).
- Give the sim a content-driven repeat count for work atomics generally, and retire the farming-block
  `workRepeats` pin into it. Keep the farm's effective value at 2 so `packages/app/test/farm-pacing.test.ts`
  stays green — this is a refactor of where the number lives, not a rebalance.
- Applying it to the hunter and fisher IS a rebalance and will move gathering pacing. Measure both against
  the running original first; do not just multiply their durations by 5 and call it faithful.
- Decode the experience relationship, or explicitly leave it out with a named approximation in the code.

## Verify

- `npm run test:pipeline` (extraction change) and `npm run test:content`.
- `packages/app/test/farm-pacing.test.ts` unchanged and green.
- Any hunter/fisher pacing change carries its own measurement of the original in the commit message.
