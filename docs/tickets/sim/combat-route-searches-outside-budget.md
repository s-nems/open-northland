# Bring the breach and sealed-target route searches under the pathfinding budget

**Area:** sim · **Focus:** conflict, palisades · **Priority:** P3
**Blocked by:** [00 Heavy-load reference](../runtime-architecture/00-heavy-load-reference.md)

`drainPathRequests` (`movement/routing.ts`) caps routing at `PATHFINDING_NODE_BUDGET_PER_TICK` (16384
settled nodes). Two combat paths call `findPath` directly, outside that cap:

- `palisadeBarring` (`palisades/breach.ts`), per breaker whose route failed: `standingWallAt` sorts every
  standing wall (`canonicalById(world.query(PalisadeBlocking, Palisade, Position))`), then
  `findPath(terrain, route.start, route.goal, blocked)` and a second `findPath` with the walls opened;
  `spreadAlongLine` then walks every `AttackOrder`.
- `sealedByStructures` (`conflict/chase.ts`), per chaser from its `SEALED_TARGET_ROUTE_FAILURES`-th
  refused route: one full `findPath` over the dynamic block overlay. A failing search can settle up to
  `GOAL_EXHAUST_MAX_EXPLORED` (32768) nodes before it gives up.

A group of N fighters stopped at a wall or a sealed target pays N sorts and up to 2N region-scale
searches in one tick. Not measured: the 100k `magiczny_las` run had no siege. The pathfinding max of
231 ms in that run is a lead, not evidence, since routing proper can spike too.

## Scope

- Measure on the 00 reference battle with a palisade in the way: the tick share and max of
  `palisadeBarring` and `sealedByStructures`. Delete this ticket if neither spikes.
- Otherwise, without changing answers: build the standing-wall map once per tick, keyed on the
  `Palisade` generations; memoize the "barred by walls" and "sealed by structures" verdicts per
  (start component, goal, overlay generation) within the tick, so a group shares one search.
- Charging these searches to the routing budget, or deferring a breaker to a later tick, changes
  behavior and needs the owner's ruling (the sim contract forbids rationing a group order's start).

## Verify

- Same state hash on the 00 battle checkpoint before and after.
- The 00 report, before and after: the pathfinding and combat max per tick fall.
- `npm test`, `npm run check`, `npm run build`.
