# Re-route only the walkers whose goal or route changed

**Area:** sim · **Focus:** settlers/planner · **Priority:** P3

`navigationPlanner` (`systems/settlers/planner/navigation.ts`) re-reads every goal-holding entity on
every tick to find the few whose route no longer serves the goal:

```ts
for (const e of world.query(Position, MoveGoal)) {
  if (world.has(e, PathRequest)) continue;
  const goalNode = world.get(e, MoveGoal).cell;
  // ...
  if (world.has(e, PathFollow)) {
    const stops = world.get(e, PathRoute).waypoints;
    if (stops[stops.length - 1]?.node === goalNode) continue; // route serves the goal
```

A walker whose goal and route are unchanged since the last pass always takes one of the `continue`s.
Walkers are active work, so this is within the scale rule, but the pass is pure lookup overhead.
Measured on `magiczny_las`, AI seats 0-6, profile from the 80k checkpoint (2000 ticks, busy box):
`navigationPlanner` 1.9% of the whole profile, most of it `world.get`.

## Scope

- Visit only entities named by a change feed (`World.watchChanges`) over `MoveGoal` membership and
  values, `PathRequest` and `PathFollow` membership and `PathRoute` values, plus any case the current
  loop handles that no such change announces (check the stand-on-goal removal and a failed request
  being dropped by another system).
- `PathRequest` insertion order changes with the visit order. Today only `navigation.ts` iterates these
  stores by insertion order and routing reads `canonicalQuery(PathRequest)`; confirm that still holds
  and keep the state hash unchanged.

## Verify

- A cache verifier (`World.registerCacheVerifier`) asserts that a full pass over
  `world.query(Position, MoveGoal)` would issue or drop nothing the feed missed.
- On an idle box, `ON_BENCH_MAP=magiczny_las ON_BENCH_SEATS=0,1,2,3,4,5
  ON_BENCH_CHECKPOINT=bench-out/ml6.t80000.checkpoint ON_BENCH_TICKS=4000 npm run bench:map` before and
  after (checkpoint from one 100k run, `docs/DEVELOPMENT.md`, Measuring performance), then
  `npm run bench:compare`: same state hash, planner median falls.
- `npm test`, `npm run check`, `npm run build`.
