# Surface livestock production stalls to the player

**Area:** app/sim · **Priority:** P3

Two verified stalls at the animal farm read as "production is broken" because nothing names them:

1. **No animal in the pen.** A staffed farm with full water/wheat but no penned animal shows 0%
   production bars with no reason surfaced; unlike input starvation this gate is not even inferable
   from the stock rows. Add a "no animals in pen" hint to the animal farm's details panel (the feed
   gate is `feedAnimalsAvailable`, `packages/sim/src/systems/livestock/processing.ts`).
2. **Feed batches grind for a tech-locked converter.** Leather and meat are hunter unlocks
   (`jobEnablesGood` in ir.json); without a live hunter the cattle feed batch still summons animals,
   consumes water+wheat and drains animal life, while the cattle token piles to its cap and the
   converter never starts. Either gate the feed recipe on its chain's converter being startable
   (generic: a token product with no enabled consumer recipe is not worth a batch) or surface the
   lock in the panel ("wymaga: myśliwy" on the chain row).

## Verify

- Browser `?scene=livestock`: an empty pen names its stall in the farm's panel.
- Browser real content, farm without a hunter: no wasted cattle feed batches, or the lock is named
  on the Wół production row.
