# Wire the already-extracted `baserepeatcounter` into work atomics, and model its experience scaling

**Area:** sim · **Origin:** farm pacing calibration, 2026-07-20 · **Priority:** P2

`Data/logic/humanjobexperiencetypes.ini` gives three trades a `baserepeatcounter` — how many strokes a
worker plays per work action, which is what a unit of output costs in labor:

| type | name | job | good | baserepeatcounter |
|------|------|-----|------|-------------------|
| 37 | hunter general | 15 | — | 5 |
| 46 | farmer wheat   | 18 | 4  | 2 |
| 65 | fisher general | 22 | —  | 5 |

The pipeline already extracts all three (`tools/asset-pipeline/src/decoders/ini/types/jobs.ts`), the
schema carries them (`packages/data/src/schema/economy/jobs.ts` `baseRepeatCounter`), and the sim indexes
them (`content-index.ts` `jobExperience`). What is missing is a CONSUMER: no work atomic reads the field.

Only the farmer's is modelled today, and only for the field loop, via a literal restated as
`GoodFarming.workRepeats` in `packages/app/src/catalog/farming.ts` and multiplied into the plant/cultivate/
harvest durations in `packages/sim/src/systems/agents/farming/planner.ts`. It is the dial the farm's whole
throughput rests on.

Three gaps:

1. **The hunter and fisher run one stroke per action**, so both are ~5× faster than the original's data
   says. Nobody has measured either against the running game; the farm was measured, they were not.
2. **"base" implies experience scales it.** `experiencefactor` sits in the same records (hunter 200,
   fisher 150, farmer wheat 100) and settlers already carry an `experience` map (`Settler.experience`),
   so a veteran presumably needs fewer strokes than a novice. That relationship is not decoded.
3. **Three modules read the key three different ways.** `packages/sim/src/systems/progression/experience.ts:59`
   calls it the non-linear XP→level curve, `packages/data/src/schema/economy/jobs.ts:42` calls it
   "repeat-count tuning", and `GoodFarming.workRepeats` asserts strokes-per-action. At most one is right;
   settle it against the original before building on any of them.

## Scope

- Give the sim a content-driven repeat count for work atomics generally, reading the indexed
  `jobExperience` track (`experience.ts` already resolves `(jobType, goodType)` → record), and retire the
  farming-block `workRepeats` into it. Keep the farm's effective value at 2 so
  `packages/app/test/farm-pacing.test.ts` stays green — this is a refactor of where the number lives, not a
  rebalance. Note the sandbox `ContentSet` defaults `jobExperience` to `[]`, so the sandbox needs either a
  seeded track or a documented fallback.
- Applying it to the hunter and fisher IS a rebalance and will move gathering pacing. Measure both against
  the running original first; do not just multiply their durations by 5 and call it faithful.
- Decode the experience relationship, or explicitly leave it out with a named approximation in the code.

## Verify

- `npm run test:pipeline` (extraction change) and `npm run test:content`.
- `packages/app/test/farm-pacing.test.ts` unchanged and green.
- Any hunter/fisher pacing change carries its own measurement of the original in the commit message.
