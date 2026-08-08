# Scale combat's per-tick spatial build with active conflict, not total units

**Area:** sim · **Focus:** conflict · **Priority:** P2

Once `combatPossible` sees any hostile pair or lingering combat state anywhere on the map,
`combatSystem` rebuilds its whole decision infrastructure from scratch every tick: the canonical
combatant and target lists, a `NodeBuckets` index over every combatant plus every attackable
building's wall nodes, and the `HostilePresence` grid. The `buildingBodyNodes` memo lives only for
the tick although buildings do not move. With six AI seats hostility exists somewhere nearly always,
so the full rebuild is the steady state even when only a handful of units actually fight.

Evidence (rev 38de1846, magiczny_las with 6 AI seats): combat is the second-largest system in both a
50k-tick `bench:map` run (28.7% share, median 2.0 -> 5.4 ms/tick, 2.7x growth) and a live speed-3
profile at tick ~28k (21.8% share). In a 45 s V8 profile, `forEachIndexNode` invoked directly under
`combatSystem` (the per-tick index build) alone is 3.9% of all sampled CPU.

## Scope

- Make the per-tick spatial build proportional to active combat: a persistent incrementally-updated
  index, a region-of-conflict build, or an equivalent. Decision canonicalization (ascending-id
  ordering of winners) must survive the change.
- Persist building wall-node sets across ticks, invalidated by construction, destruction, or footprint
  change.
- The same rebuild-per-tick pattern exists in `separationSystem`'s `collectColliders` (7.7x growth to
  ~5% share in the same bench) and the livestock summon pass; extend the mechanism to them if it
  generalizes, otherwise leave them untouched and keep this ticket bounded to combat.
- Related but a different term: [garrison ring search](garrison-ring-search-cost.md) covers duplicated
  per-seat searches inside the pass this ticket feeds.

## Verify

- `npm run bench:map` before/after: combat share and growth curve drop on the same box.
- Goldens and atomic traces byte-identical (cost work, not behavior work); a combat scenario test run
  confirms identical engagement picks.
- `npm test`, `npm run check`, `npm run build`.
