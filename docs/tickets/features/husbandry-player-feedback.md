# Surface livestock production stalls to the player

**Area:** app · **Priority:** P3

Two verified stalls at the animal farm read as "production is broken" because the panel names
neither. The sim side is done - the summon gate (`summonToWorkplaces`,
`packages/sim/src/systems/livestock/processing.ts`) already refuses to call an animal for a starved,
seatless, token-backlogged, or tech-locked chain - so what remains is naming the reason in the UI:

1. **No animal in the pen.** A staffed farm with full water/wheat but no penned animal shows 0%
   production bars with no reason surfaced; unlike input starvation this gate is not even inferable
   from the stock rows. Add a "no animals in pen" hint to the animal farm's details panel (the feed
   gate is `feedAnimalsAvailable`).
2. **Tech-locked chain.** Without a live hunter the cattle chain does not run at all (the summon
   skips a chain whose converter is locked - `tokenConsumable`), which is correct but silent: the
   Wół row just sits idle. Name the lock on the chain row ("wymaga: myśliwy").

## Verify

- Browser `?scene=livestock`: an empty pen names its stall in the farm's panel.
- Browser real content, farm without a hunter: the lock is named on the Wół production row.
