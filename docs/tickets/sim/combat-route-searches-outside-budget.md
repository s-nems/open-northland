# Reduce synchronous combat route-search spikes without changing answers

**Area:** sim · **Focus:** conflict, palisades · **Priority:** P3

`drainPathRequests` (`movement/routing.ts`) caps routing at `PATHFINDING_NODE_BUDGET_PER_TICK` (16384
settled nodes). Combat paths call `findPath` directly, outside that cap:

- `palisadeBarring` (`palisades/breach.ts`), per breaker whose route failed: `standingWallAt` sorts every
  standing wall (`canonicalById(world.query(PalisadeBlocking, Palisade, Position))`), then
  `findPath(terrain, route.start, route.goal, blocked)` and a second `findPath` with the walls opened;
  `spreadAlongLine` then walks every `AttackOrder`.
- `sealedByStructures` (`conflict/chase.ts`), per chaser from its `SEALED_TARGET_ROUTE_FAILURES`-th
  refused route: one full `findPath` over the dynamic block overlay. A failing search can settle up to
  `GOAL_EXHAUST_MAX_EXPLORED` (32768) nodes before it gives up.

- `startVehicleDrive` → `vehicleRouteTo` (`vehicles/movement.ts`), also called by `engageVehicle`,
  performs a synchronous route search under vehicle clearance and other-vehicle blockers.

A group of N fighters stopped at a wall or a sealed target pays N sorts and up to 2N region-scale
searches in one tick. Not measured: the 100k `magiczny_las` run had no siege. The pathfinding max of
231 ms in that run is a lead, not evidence, since routing proper can spike too.

The current seed-7 `magiczny_las` replay provides a separate measured vehicle case: at tick 99394,
two runs spend 45.37/45.56 ms in combat, within 52.99/53.11 ms total. An isolated one-tick CPU
profile attributes about 50 ms of inclusive samples to `engageVehicle → startVehicleDrive →
vehicleRouteTo → findPath`. Repeated passability checks dominate that stack; this does not identify
sealed-target or breach searches as the cause.

## Scope

- The vehicle search already memoizes complete walk-block verdicts within one synchronous call,
  which cut that tick's combat maximum from about 45 to 31 ms while preserving route answers.
  Profile the remaining search cost before adding another cache. Keep exported
  overlay behavior and fresh answers after blocker changes; cross-search reuse needs a proven
  invalidation boundary.
- Measure the other paths on the `ON_BENCH_FIGHTERS` battle of `npm run bench:sim` with a palisade in the way: the tick share and max of
  `palisadeBarring` and `sealedByStructures`. Drop the unmeasured breach/sealed-target scope if neither spikes.
- Otherwise, without changing answers: build the standing-wall map once per tick, keyed on the
  `Palisade` generations; memoize the "barred by walls" and "sealed by structures" verdicts per
  (start component, goal, overlay generation) within the tick, so a group shares one search.
- Charging these searches to the routing budget, or deferring a breaker to a later tick, changes
  behavior and needs the owner's ruling (the sim contract forbids rationing a group order's start).

## Verify

- Same complete state and route answers on the measured checkpoint before and after.
- Guarded before/after reports: reduce the targeted pathfinding or combat cost without a repeatable
  regression in ordinary tick time; report allocation and tail-latency tradeoffs.
- `npm test`, `npm run check`, `npm run build`.
