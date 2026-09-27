# Back off an AI collector's re-plant search after it finds no workable spot

**Area:** sim · **Focus:** ai-player/workforce/collectors · **Priority:** P2
**Needs user:** how long a collector whose patch is worked out may keep his post before the seat tries
again or moves him to the builder pool

`upkeepHolders` (`ai-player/workforce/collectors/upkeep.ts`) sends every holder whose patch is no
longer worked to `replantSpot` on every decision of its seat. When the search finds nothing
(`replant === null`), the holder keeps his post and the next decision, 24 ticks later, runs the same
search again (see `Replant`). Each search floods for flag spots (`flag-spots.ts` `flagGround`, origin
floods up to `ORIGIN_FLOOD_BUDGET_NODES`; `walk-distance.ts` `WalkFlood`), so a seat with a few such
holders pays tens of thousands of settled nodes in one tick, every decision, for an answer that does
not change.

Measured on `krwawa_rzeka`, 12 AI seats (`docs/perf/heavy-load-krwawa-rzeka-12ai.md`), 2000 ticks from
t80k on a quiet box: seat 5's decision pass averages 51 ms and peaks at 121 ms while the other seats
average 6 to 9 ms. Per pass it has 5.4 dead holders, 16.4 flag-spot searches and 3.3 exhausted origin
floods (53 800 settled nodes); 497 of 497 re-plants over the window returned null. In the 100k run, 9
of the 10 slowest ticks (up to 411 ms on the loaded box) fall on seat 5's decision slot, not on a
relocation round. In the t80k profile `upkeepHolders` is 12.8% of the sim, 9% of it the
`replantSpot` -> `flagSpotNear` -> `cheapestRingNode` -> `legOf` -> `WalkFlood.costTo` chain.

No cache of the floods across decisions is hash-identical: they key on the dynamic block overlay,
which moves with every resource or building change.

## Scope

- A holder whose re-plant found nothing is not searched again until a named number of decisions has
  passed or the seat's relocation round comes, whichever is first; after a named number of consecutive
  misses he rejoins the builder pool as a dry holder does. The owner rules on both numbers.
- Behaviour change: AI collectors re-aim later; goldens and scenes over AI seats move, named in the
  commit.

## Verify

- `bench:map` from the reference's t80k checkpoint for 2000 ticks: seat 5's pass mean and max fall to
  the healthy seats' range (relocation rounds 18 to 31 ms mean, 40 to 68 ms max), and the slowest-tick
  list no longer sits on one seat's slot.
- The AI workforce tests and acceptance scenes pass; `npm test`, `npm run check`.
