# Surface a no-animal production stall to the player

**Area:** app · **Priority:** P3

A staffed animal farm with full water/wheat but no penned animal shows 0% production bars with no
reason surfaced; unlike input starvation this gate is not even inferable from the stock rows. Add a
"no animals in pen" hint to the animal farm's details panel (the feed gate is
`feedAnimalsAvailable`, `packages/sim/src/systems/livestock/processing.ts`).

## Verify

- Browser `?scene=livestock`: an empty pen names its stall in the farm's panel.
