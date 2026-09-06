# Replace the authored field-growth timer with the observed growth rule

**Area:** sim, app, data · **Focus:** economy/fields, drives/farming, catalog/farming · **Priority:** P2
**Needs user:** the four observations below, on a fresh farm in the running original.

A sown field grows on a per-field timer that one watering unlocks: `cropGrowthSystem`
(`packages/sim/src/systems/economy/fields.ts`) advances `Crop.growth` every tick while `watered` holds,
steps `stage` at `ticksPerStage`, and `stageTicksAt` spreads that pace per node so a plot ripens out of
step. The timer, its spread (`GoodFarming.growthSpreadPercent`, `GROWTH_BANDS`) and the `watered` latch
are authored stand-ins, and `packages/app/src/catalog/farming.ts` tunes the whole farm around them. With
sowing and watering landing on one clip, the shipped balance runs 40-110% above the original's observed
~10 grain per farmer per 10 minutes - double for a lone farmer - and a lone farmer's first sheaf lands
at tick ~5100, about seven minutes, because the plot fills before the can starts.

What the readable data pins: `landscapetypes.ini` `wheat (growing)` (type 27, `maximumValency 5`) steps
its valency by `transition 7 27 2 +1 0`, the same kind-7 trigger `tree`, the bushes, `honeymine`,
`herbmine` and `mushroommine` carry, which the repo reads as periodic growth for bushes
(`packages/sim/src/systems/economy/berries.ts`); and the farmer's cultivate clip fires the `GROW` cue
once per play (`atomicanimations.ini` `event 14 16`: frame 14, type 16 as named in
`Data/GameSourceIncludes/logicdefines.inc`), so the can does step a field. The data does not say whether
a clock steps it as well, how far a watering reaches, or how many fields a farmer keeps.

## Scope

- Observe first (Needs user), one farmer on a fresh farm in the original: (1) does the farmer plough the
  whole plot before the first watering; (2) does a plant that is never watered advance a stage; (3) does
  one pass with the can advance the plants beside the target as well as the target; (4) how many plants
  stand once the plot is full. Record the answers as observation in the completing commit.
- Make growth follow the observed rule. If the can alone advances a plant: delete `cropGrowthSystem`, its
  schedule slot, `Crop.growth`, `ticksPerStage` and `watered`, and the `GoodFarming` fields
  `ticksPerStage` and `growthSpreadPercent` (schema, fallback catalog, fixtures, and the save migration
  seam if a persisted shape carries them); a thirsty field is then any field below `stages`. If a clock
  advances it, keep one timer whose period comes from the observation and drop the per-node spread.
- If a watering reaches neighbouring plants, apply the observed reach in `applyWater`, and let sowing
  place fields next to each other: the lattice in `drives/farming/targets.ts` keeps them two nodes
  apart, out of any neighbour's reach. Pin which of `stepsInto`'s eight step offsets count as neighbours
  with a test on a known layout.
- Recalibrate `catalog/farming.ts` against the observed rate and standing-plant count; re-derive the
  bands in `packages/app/test/farm-pacing.test.ts`, pin a lone farmer's first-grain latency there, and
  re-tighten `RUN_TICKS` in `packages/app/src/scenes/chain.ts` and `FARM_TICKS` in
  `packages/app/test/content/farming-scenario.test.ts` to the new cold start.
- Non-goals: the plot anchor and which farm a field belongs to
  ([farm-plot-shared-around-anchor](farm-plot-shared-around-anchor.md)), and what a farmer does while
  every wheat store is full.

## Verify

- Unit: the observed rule and nothing else moves a field's stage - over any number of ticks a field
  advances only as the rule says, and a watering advances exactly the plants the observation showed.
- The plot keeps mixed heights: over a lone farmer's ten-minute window no single stage holds more than
  about 60% of a full plot.
- `packages/sim/test/economy/farming.test.ts` and `packages/app/test/farm-pacing.test.ts` green on the
  re-derived bands with the first-grain latency pinned; golden hashes move once, intentionally.
- `npm run test:content` and `npm run test:pipeline` if the `GoodFarming` schema changes.
