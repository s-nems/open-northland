# Surface livestock production stalls to the player

**Area:** app · **Priority:** P3

Two verified stalls at the animal farm read as "production is broken" because the panel names
neither. The sim side is done - the summon gate (`summonToWorkplaces`,
`packages/sim/src/systems/livestock/processing.ts`) already refuses to call an animal for a starved,
seatless, token-backlogged, or tech-locked chain - so what remains is naming the reason in the UI.

## Scope

1. **No animal in the pen.** A staffed farm with full water/wheat but no penned animal shows 0%
   production bars with no reason surfaced; unlike input starvation this gate is not even inferable
   from the stock rows. Add a "no animals in pen" hint to the animal farm's details panel (the feed
   gate is `feedAnimalsAvailable`).
2. **Tech-locked chain.** An authored map can forbid the cattle chain's converter output. Name
   that permission lock on the animal row. Discoveries persist after a hunter retires, so the
   absence of a living hunter is no longer a valid explanation for the stall.

## Verify

- Browser `?scene=livestock`: an empty pen names its stall in the farm's panel.
- Browser real content with a scripted output ban: the lock is named on the Wół production row.
