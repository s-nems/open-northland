# Make a production cycle's length the produce clip's length

**Area:** pipeline, sim · **Priority:** P3

Every synthesized in-house recipe runs for `DEFAULT_RECIPE_TICKS`
(`tools/asset-pipeline/src/stages/ir/building-recipes.ts`), so a workplace produces at one speed
whatever it makes. Output amount answers to the worker's experience and tool (`accrueBonusOutput`,
`accrueDepositBonus`); time does not, and neither does it in the original.

Original behavior: an in-house cycle is one playthrough of the workplace's produce clip, whose length
is authored per clip in `atomicanimations.ini` (viking baker and miller 200 ticks, smith 240, potter
80, well, hive and mead 50, druid potions 400). Neither experience nor a tool shortens it; the
repeated-strokes rule belongs to gathering and fishing, and building has its own steps rule.

## Scope

- Carry each recipe's produce clip length into the IR as its `ticks`, keeping `DEFAULT_RECIPE_TICKS`
  only as the named fallback for a recipe whose building has no produce clip.
- Keep the output amount rule as it is; a cycle's length is the only thing that changes.
- Rebalance the animal farm if the 50-tick and 100-tick breeding clips make calves arrive far faster
  than they grow up (3600 ticks to adulthood); name any cap as an approximation.

## Verify

- Sim tests: a baker's cycle takes its clip length; a building without a produce clip keeps the
  fallback.
- `npm run test:content`: the real-content scenarios still complete their production in budget.
- Golden hashes move once, intentionally.
