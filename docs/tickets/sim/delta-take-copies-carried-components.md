# Take and apply a snapshot delta per written component, not per carried one

**Area:** sim, app · **Focus:** inspect/snapshot-clones, snapshot-mirror · **Priority:** P2

Every tick the worker takes a delta (`SnapshotDeltaStream.next`, `inspect/snapshot-clones.ts`) and the
main thread applies it (`SnapshotMirror.apply`). Both ends pay per component an entity carries rather
than per component the tick wrote:

- `cloneEntity` walks every component of every touched entity through `World.forEachComponent`, with
  a store and a revision Map lookup each, and builds two fresh string-keyed records per entity
  (`components`, `componentRevisions`); `changesOf` then runs `Object.keys` over both revision records
  and builds a third. A touched entity carries 14 components on average and writes 2.4.
- A written component is deep-copied whole through the generic `clonePlain`: a hunger drain re-clones
  all of `Settler`, a `legTicks` step all of `PathFollow`, a route write the whole waypoint array.
- `ascending` spreads and sorts the pending id set per delta.
- The mirror's `merge` makes a new entity object per touched entity (`patched`), 200 MB per 10 s on the
  main thread in the live late-game profile.

Measured on `krwawa_rzeka`, 12 AI seats, t100k (`docs/perf/heavy-load-krwawa-rzeka-12ai.md`,
`ON_BENCH_MIRROR=on`): 1453 touched entities and 3542 written components per delta; take p50 5.2 to
6.8 ms against a 15 to 17 ms sim tick, serialize 0.9 ms, deserialize 1.7 ms, bare apply 0.8 to 1.1 ms.
In the live worker profile at 82k, `takeBatch` is 14% of the worker (`changesOf` 12%, `cloneEntity`
11%), and `forEachComponent` is 5.4% self.

The [late-game reference](../../perf/magiczny-las-late-game.md), `magiczny_las`, seed 7,
AI seats 0-6, restores tick 97200, warms for 200 ticks and measures 500 ticks. Its Node mirror
probe includes all 700 deltas in these medians: 2124 changed entities, 5268 written components and
397 KiB serialized per delta; take 8.31 ms, serialize 1.24 ms, deserialize 2.56 ms, bare apply
1.31 ms and apply with frame indexes 3.73 ms. The probe checks mirror and index parity at the
window end. It runs independent mirror copies sequentially, so these stage timings are proxies
for their individual cost, not a live browser's total frame time.

## Scope

- The ECS records, per entity, which components were written or removed since the stream last drained
  it; the take clones those only and reuses the previous revision record instead of rebuilding it.
- A flat component (numbers, strings, small fixed records) takes a monomorphic copy instead of the
  generic `clonePlain` recursion.
- The mirror patches a held entity without allocating a replacement per touched entity where no reader
  depends on the object identity changing; list the readers that do (memos keyed on entity objects)
  and keep their contract.
- The delta's shape and the mirror's result stay identical: `diffSnapshots` against the live snapshot
  finds nothing, as the probe already checks per window.

## Verify

- `ON_BENCH_MIRROR=on` from the reference's t100k checkpoint: take and apply p50 against the numbers
  above, and the probe's per-window mirror check passes. Also repeat the `magiczny_las` tick-97200
  reference with its 200 warm-up and 500 measured ticks, keeping the delta sample basis identical.
- The snapshot mirror and snapshot structured-clone tests, the cache verifier, `npm test`,
  `npm run check`.
