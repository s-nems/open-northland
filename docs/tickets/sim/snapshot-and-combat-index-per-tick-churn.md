# Cut the per-tick allocation churn of the snapshot and the combat index

**Area:** sim · **Focus:** inspect/snapshot, conflict/combat-index · **Priority:** P3

Two sim paths allocate map-sized structures every tick. `takeSnapshot` (`inspect/snapshot.ts`) builds
a fresh `entities` array over `world.canonicalEntities()` for all ~26k entities although the clone cache
reuses every untouched entity object; allocation sampling of the fortress at tick ~48k (x3, 45 s)
attributed 845 MB to the array and 818 MB to the iterator. `CombatIndex` (`conflict/combat-index.ts`)
is rebuilt each combat tick with fresh coarse-cell records and member arrays (`admit` 344 MB,
`candidatesInBand` 157 MB over the same window). Neither leaks, but together they are a quarter of the
client's ~174 MB/s churn and the collector pays for it inside the frame.

## Scope

- Snapshot: reuse the previous `entities` array when no entity was created or destroyed since the last
  snapshot (membership can be read from the world's entity generation), replacing only the dirty
  entries. The returned `WorldSnapshot` must stay a detached value: an older snapshot a consumer still
  holds must not observe the mutation, so a reused array is only valid when the previous snapshot object
  is the one being superseded (check how `Simulation.snapshot` memoizes and how the scene cache holds
  snapshots by identity).
- Combat index: keep the per-world coarse-cell records and member arrays between ticks and reset their
  lengths instead of reallocating; candidate keys can use a reusable `Float64Array` when no query is
  re-entered. Winners must stay identical (the equivalence test in
  `test/conflict/combat-index-search.test.ts` covers that).

## Verify

- Repeat the allocation sampling: both sites drop by an order of magnitude; state hash of a 600-tick
  run from the fortress checkpoint unchanged (`ON_BENCH_CHECKPOINT`, see docs/DEVELOPMENT.md).
- `npm test`, `npm run check`.
