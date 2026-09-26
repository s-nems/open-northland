# Carry only the changed components in the snapshot delta

**Area:** sim · **Focus:** inspect/snapshot-clones, inspect/snapshot-mirror · **Priority:** P2

`Simulation.snapshotDeltas()` lists a touched entity whole: every component clone of an entity that
changed since the last delta. Measured with `ON_BENCH_MIRROR=on` on `magiczny_las_12_players` with 12
AI seats and the observer from a checkpoint at tick 40k (1032 settlers, 37.3k entities): about 880
entities change per tick, nearly all of them walking settlers whose `Position` moved, and the delta
weighs 1.2 to 1.3 MB as JSON. Its structured clone costs 12.5 to 15.4 ms p50 per tick in one process
against a 7 ms tick; the worker of 04 would pay the serialising half and the main thread the
deserialising half, on every tick, for a change that is a few numbers per settler. The clone cache
already reuses every component clone whose revision held, so the sim knows which components changed.

## Scope

- A touched entry carries the entity id, the components whose revision changed since the base with
  their fresh clones, and the names of components removed since the base; a created entity carries all
  of its components. The stream derives this from the cache's per-entity component revisions, with no
  second pass over the world and no diffing of values.
- `SnapshotMirror` builds the touched entity's new object from the previous object and the entry, so
  the identity contract holds unchanged: a touched entity is a new object, an unchanged component clone
  inside it is the previous one, an untouched entity is the same object. A rebuild delta stays whole.
- `SnapshotDelta` stays structured-cloneable; the structured-clone test covers the new entry shape.

## Verify

- The mirror parity tests over the settlement run and the scene registry pass unchanged.
- `ON_BENCH_MIRROR=on` on the same checkpoint reports the delta size and clone cost per tick before and
  after; the commit names both.
- Hashes and goldens unchanged. `npm test`, `npm run check`, `npm run build`.
