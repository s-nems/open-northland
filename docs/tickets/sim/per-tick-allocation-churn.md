# Stop spatial buckets, separation and field zones from allocating per tick

**Area:** sim · **Priority:** P3

Garbage collection grows with the settlement. On `magiczny_las_12_players` with 13 AI seats, a
sampling heap profile that keeps collected objects (`node:inspector` `HeapProfiler.startSampling`
with `includeObjectsCollectedByMajorGC` and `includeObjectsCollectedByMinorGC`, builtin frames such
as `next` charged to their JS caller), taken over 300 ticks from the 50k checkpoint after a 100-tick
warm-up, records 3.8 MB allocated per tick. By share of sampled bytes:

- 9.6% is `NodeBuckets` (`systems/spatial/nodes.ts`) built from scratch, a `Map` per column and an
  array per bucket. Per-tick owners: `collectColliders`' mover and post indexes, the gossip
  candidates, `ExternalQualityIndex`, and `PlannerSpacing.forTick`, which
  [planner-pass-setup-scales-with-world.md](planner-pass-setup-scales-with-world.md) owns.
- 8.9% is `separationSystem` (`systems/movement/collision/separation.ts`) itself: fresh `{ x, y }`
  candidate and world points per mover, and iterator garbage not yet traced to a line.
- 3.7% is the planner's `fieldZones` set (`systems/settlers/targets/candidates.ts`), rebuilt on first
  use every tick.

## Scope

- `NodeBuckets` for the owners outside the planner-pass ticket: a flat node-keyed layout with
  ascending-id buckets, cleared and refilled in one instance instead of a new one per tick.
- `separationSystem`: find the iterator garbage, and reuse point scratch per mover instead of
  allocating it.
- `fieldZones`: keep the set across ticks or refill one instance.
- Pure cost work: the state hash must stay identical.

## Verify

- Unit: `NodeBuckets.nearest` and `at` answer as before after a clear and refill.
- The recipe in `docs/DEVELOPMENT.md` (Measuring performance) writes the checkpoints. With its session
  env, `ON_BENCH_CHECKPOINT=<40k checkpoint> ON_BENCH_TICKS=4000 npm run bench:map` before and after,
  then `npm run bench:compare`, on an idle box, trust clean: the per-window `gc ms` and `gc n` columns
  fall, the state hash unchanged. The same heap sampling from the 50k checkpoint shows the bytes per
  tick fall and the listed owners gone from the allocators above 1%.
- `npm test`, `npm run check`, `npm run build`.
