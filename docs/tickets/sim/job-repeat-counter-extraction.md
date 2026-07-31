# Wire the already-extracted `baserepeatcounter` into the hunter and fisher work atomics

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
them (`content-index.ts` `jobExperience`).

The farmer's is modelled via the literal `GoodFarming.workRepeats` in
`packages/app/src/catalog/farming.ts`, multiplied into the plant/cultivate/harvest durations in
`packages/sim/src/systems/settlers/drives/farming/drive.ts`. Experience scaling of the stroke count exists
(`scaledWorkRepeats` there; a named approximation, feat/experience branch) — the remaining question is
only where the BASE number comes from.

Remaining gaps:

1. **The hunter and fisher run one stroke per action**, so both are ~5× faster than the original's data
   says. Nobody has measured either against the running game; the farm was measured, they were not.
2. **The base count is a restated literal, not the extracted field.** `GoodFarming.workRepeats` asserts
   strokes-per-action while `packages/data/src/schema/economy/jobs.ts:42` calls the same key
   "repeat-count tuning"; settle the reading against the original, then retire the farming-block literal
   into the indexed `jobExperience` track.

## Scope

- Give the sim a content-driven repeat count for work atomics generally, reading the indexed
  `jobExperience` track (`progression/experience.ts` already resolves `(jobType, goodType)` → record),
  and retire the farming-block `workRepeats` into it. Keep the farm's effective value at 2 so
  `packages/app/test/farm-pacing.test.ts` stays green — this is a refactor of where the number lives, not
  a rebalance. Note the sandbox `ContentSet` defaults `jobExperience` to `[]`, so the sandbox needs either
  a seeded track or a documented fallback.
- Applying it to the hunter and fisher IS a rebalance and will move gathering pacing. Measure both against
  the running original first; do not just multiply their durations by 5 and call it faithful. (The user
  reversed the 2026-07-23 no-experience decision on 2026-07-30: the hunter now accrues its extracted
  `hunter_general` track through the ordinary work-XP seam on carcass harvests. This ticket remains
  about the BASE stroke count only.)

## Verify

- `npm run test:pipeline` (extraction change) and `npm run test:content`.
- `packages/app/test/farm-pacing.test.ts` unchanged and green.
- Any hunter/fisher pacing change carries its own measurement of the original in the commit message.
