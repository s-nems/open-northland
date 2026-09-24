# Keep the building walk-block cache across construction progress

**Area:** sim · **Focus:** footprint · **Priority:** P2

`buildingBlockedCells` (`systems/footprint/building-blocked-cache.ts`) memoizes the cells standing
buildings block, keyed on the `Building` store's membership and value generations. `built` lives on
`Building`, and `advanceSite` (`systems/economy/construction.ts`) writes it through `World.mut` on
every construction advance, so any tick in which some site is hammered invalidates the cache and the
next reader re-runs `deriveBuildingBlockedCells` over every building (footprint translation plus a
`doorPassage` flood per door). The file already names this: "an actively hammered site costs a
rebuild per advance". With 13 AI seats building all game, that is about one full rebuild per tick.

On `magiczny_las_12_players` with 13 AI seats, `deriveBuildingBlockedCells` costs 1,082 ms over the
4,000 profiled ticks from the 40k checkpoint (209 buildings, 0.27 ms/tick) and 1,356 ms over 2,000
ticks from the 60k checkpoint (233 buildings, 0.68 ms/tick; busy machine, and profiled timings are
inflated by the sampler). Whoever reads the overlay first in a tick pays it, which is why it shows up
under other systems' names: at 60k 876 ms of it lands in `animalWanderSystem` (71% of that system's
cost), 214 ms in the planner's `collectTargets`, 175 ms in `attackMoveUnit`'s
`reachableMoveGoal`, 61 ms in the AI garrison draft. The same key drives `RouteRegions.refresh`
(`systems/footprint/route-regions.ts`), so every construction advance also drops all route-region
pocket labels and the AI scout's `nextSignpostTarget` refloods its pockets on its next pass. The
cost grows with the building count times construction activity, not with any change to a wall.

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
- Session and checkpoint recipe: the twelve-player run in `docs/DEVELOPMENT.md` (Measuring
  performance); a checkpoint family from this session's 60k run exists in the worktree's `bench-out/`.
  `ON_BENCH_CHECKPOINT=<60k checkpoint> ON_BENCH_TICKS=2000 npm run bench:map`, then
  `npm run bench:compare`: `animalWander` median drops by about two thirds, planner and pathfinding a
  little. The state hash must stay identical.
- `npm test`, `npm run check`, `npm run build`.
