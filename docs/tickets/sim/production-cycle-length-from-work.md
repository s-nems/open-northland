# Make a production cycle's length the work it takes, not a flat constant

**Area:** pipeline, sim · **Priority:** P3

Every synthesized in-house recipe runs for `DEFAULT_RECIPE_TICKS`
(`tools/asset-pipeline/src/stages/ir/building-recipes.ts`), so a workplace produces at one speed
whatever the worker knows and whatever tool it holds. Output amount already answers to both
(`accrueBonusOutput`, `accrueDepositBonus`); time does not.

The original spends a cycle repeating the work animation a computed number of times:
`max(1, baseRetries * 100 / toolFactor - experienceFactor / 20)`, where the tool factor is
100 / 125 / 175 for none / wooden / iron and the experience factor comes from the worker's track.
So a cycle is `retries x clip length`, and both tools and experience shorten it.

Consequence: the economy's pace is authored nowhere. It also makes the animal farm's calves arrive
20x faster than they grow up (180 ticks per breeding against 3600 to adulthood), which is why a herd
fills its row long before the first slaughter.

## Investigate first

`baseRetries` is not in `goodtypes.ini` or `jobtypes.ini`. Find what feeds it in the original before modelling
anything: a per-good table, a house record, or a constant.
If it turns out to be a constant, the ticket shrinks to applying the tool and experience factors to
`recipe.ticks`.

## Scope

- Carry the cycle's base length into the IR from whatever the investigation finds, keeping
  `DEFAULT_RECIPE_TICKS` only as the named fallback for a recipe the data does not cover.
- Shorten a running cycle by the operator's tool and experience the way the original does. The
  duration is fixed at `beginCycle`, so decide deliberately whether a worker swap mid-batch re-rates it.
- Name the result as an approximation where the retry model is not reproduced frame for frame.

## Verify

- Sim tests: a tooled and an experienced operator finish a batch sooner than a bare one, by the
  factors above.
- `npm run test:content`: the real-content scenarios still complete their production in budget.
- Golden hashes move once, intentionally.
