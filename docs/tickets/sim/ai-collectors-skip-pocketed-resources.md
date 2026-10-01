# Keep AI collector flags off resources sealed in a pocket

**Area:** sim · **Focus:** ai-player/workforce/collectors · **Priority:** P2

The AI's collector searches pick the nearest resource through `CollectorGround.workable`
(`ai-player/workforce/index.ts`): same walkable component as the base (`reachableResourceTest`), stance
cells not blocked (`workableResourceTest`) and inside the signpost limit. None of them reads
`RouteRegions` (`footprint/route-regions.ts`), so a resource whose work cell is sealed inside a pocket of
buildings, resources or landscape still passes. `flagSpotNear` then finds a legal flag spot beside it,
and `GathererReach.canWork` (`ai-player/live-resources.ts`) rejects it because `regions.unroutable`
holds between the flag centre and the work cell.

On `krwawa_rzeka`, 12 AI seats, 600 ticks from the reference's t80k checkpoint
(`docs/perf/heavy-load-krwawa-rzeka-12ai.md`): 441 of 441 of seat 5's failed re-plant attempts are iron,
two deposits, each rejected only on `unroutable=true` (same component, need met, atomic allowed, in
radius, not blocked). The seat's iron posts never produce. The re-plant now runs in the assistant's flag
follow (`assistant/flag-follow.ts`), whose nearest-resource test has the same gap; its misses retire each
such holder, and the next decision hires a spare man at the same deposit through `collectorSpot`,
which checks no `canWork` at all, so the post cycles between builder and iron collector (11 hires in 83
decisions of seat 5).

## Scope

- The nearest-resource tests used by the collector hire (from the base) and the flag follow's re-plant
  (from the flag) drop a resource whose work cell is provably unroutable from there
  (`RouteRegions.unroutable`, fail-open as it already is), so the search moves on to a deposit the seat
  can reach, or reports the good dry.
- Behaviour change: AI collectors aim at other deposits; goldens over AI seats move, named in the commit.

## Verify

- A unit case: a deposit walled into a pocket is skipped for the next one, and a seat with only pocketed
  deposits of a good hires nobody for it.
- The per-seat count probe from the t80k checkpoint: seat 5 hires no iron collector it then retires, and
  its re-plant misses fall to the other seats' level.
- `npm test`, `npm run check`.
