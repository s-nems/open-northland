# Keep the building walk-block cache across construction progress

**Area:** sim · **Focus:** footprint · **Priority:** P2

`buildingBlockedCells` (`systems/footprint/building-blocked-cache.ts`) memoizes the cells standing
buildings block, keyed on the `Building` store's membership and value generations. `built` lives on
`Building`, and `advanceSite` (`systems/economy/construction.ts`) writes it through `World.mut` on
every construction advance, so any tick in which some site is hammered invalidates the cache and the
next reader re-runs `deriveBuildingBlockedCells` over every building (footprint translation plus a
`doorPassage` flood per door). The file already names this: "an actively hammered site costs a
rebuild per advance". With 13 AI seats building all game, that is about one full rebuild per tick.

On `magiczny_las_12_players` with 13 AI seats, the trust-clean `npm run bench:profile` from the 40k
checkpoint puts `deriveBuildingBlockedCells` at 1,082 ms over 4,000 ticks (209 buildings, 0.27 ms per
tick; profiled timings are inflated by the sampler). The busy-machine profile from 60k shows 1,356 ms
over 2,000 ticks (233 buildings; absolute ms suspect). Whoever reads the overlay first in a tick pays
it, which is why it shows up under other systems' names: this rebuild is 48% of `animalWanderSystem`'s
cost at 40k (71% at 60k), and the rest lands in the planner's `collectTargets`, `attackMoveUnit`'s
`reachableMoveGoal` and the AI garrison draft. The same key drives `RouteRegions.refresh`
(`systems/footprint/route-regions.ts`), so every construction advance also drops all route-region
pocket labels and the AI scout's `nextSignpostTarget` refloods its pockets on its next pass. The cost
grows with the building count times construction activity, not with any change to a wall.

Expected gain: about 0.27 ms of the 18.7 ms tick at 40k, plus the scout's pocket refloods. P2 despite
the size because the same invalidation also discards the route-region labels and the node mask
[nav-step-primitives-cost.md](nav-step-primitives-cost.md) builds on.

## Scope

- Invalidate the building cells, and the route-region epoch, only when a building's blocked cells can
  change: membership, `buildingType` (the home tier swap), or its anchor. Either move construction
  progress off the value the cache keys on, or keep a per-building (type, anchor) record so a value
  bump that changed neither skips the rebuild. A `built`-only write must not rebuild.
- Keep `verifyBuildingBlockedCache` as the coherence check; it must still catch an in-place change
  that bypasses the new key.
- Derived state only: no save or hash change.

## Verify

- Headless: advancing a construction site does not re-derive the cells (count derivations through a
  test seam or the verifier), while a tier upgrade and a placement still do.
- The recipe in `docs/DEVELOPMENT.md` (Measuring performance) writes the checkpoints. With its session
  env, `ON_BENCH_CHECKPOINT=<40k checkpoint> ON_BENCH_TICKS=4000 npm run bench:map` before and after,
  then `npm run bench:compare`, on an idle box, trust clean: `animalWander` median drops by about
  half, planner and pathfinding a little. The state hash must stay identical.
- `npm test`, `npm run check`, `npm run build`.
