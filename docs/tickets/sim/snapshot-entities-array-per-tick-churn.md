# Reuse the snapshot's entities array between ticks

**Area:** sim · **Focus:** inspect/snapshot · **Priority:** P3

`takeSnapshot` (`inspect/snapshot.ts`) builds a fresh `entities` array over
`world.canonicalEntities()` for all ~26k entities on every call, although the clone cache reuses every
untouched entity object. `World.canonicalEntities()` is memoized, but any `create` or `destroy` drops
the memo, so late-game entity churn rebuilds its sorted list most ticks. Allocation sampling of a live
session of `specjalna_forteca` with its 13 AI seats at tick ~48k (x3, 45 s) attributed 845 MB to the
array and 818 MB to the iterator, a large share of the client's ~174 MB/s churn, and the collector
pays for it inside the frame. The benches never call `snapshot()`, so this shows only in a live
session.

## Scope

- Reuse the previous `entities` array when no entity was created or destroyed since the last snapshot
  (membership can be read from the world's entity generation), replacing only the dirty entries.
- The returned `WorldSnapshot` must stay a detached value: an older snapshot a consumer still holds
  must not observe the mutation, so a reused array is only valid when the previous snapshot object is
  the one being superseded. Check how `Simulation.snapshot` memoizes and how the scene cache holds
  snapshots by identity.

## Verify

- Repeat the allocation sampling in a live late-game session: the entities array and the iterator
  drop by an order of magnitude.
- State hash of a 600-tick run from a late checkpoint unchanged: `ON_BENCH_MAP=specjalna_forteca
  ON_BENCH_SEATS=13 ON_BENCH_SKIP=48000` with a checkpoint, per the recipe in `docs/DEVELOPMENT.md`
  (Measuring performance).
- `npm test`, `npm run check`.
