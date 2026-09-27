# Keep A* node state in typed arrays instead of an object per discovered node

**Area:** sim · **Focus:** nav/pathfinding · **Priority:** P3

`ResumableSearch` (`nav/pathfinding/find-path.ts`) allocates a `NodeRecord` object for every node it
discovers and stores it in the per-graph `SearchScratch.records` (`nav/pathfinding/scratch.ts`), where
it stays referenced until a later search overwrites that slot. The records therefore survive young-gen
scavenges and are promoted, and the old generation fills with dead search records that only a
mark-compact reclaims.

Measured on `krwawa_rzeka`, 12 AI seats, t100k (`docs/perf/heavy-load-krwawa-rzeka-12ai.md`):
`advance` and the constructor allocate 165 KB a tick; a promotion profile (allocation sampling without
minor-GC-collected objects) puts `advance` at 145 of the 411 KB promoted per tick (35%), the largest
single source of old-generation garbage. The retained live set after a full GC is 175 to 186 MB while
the heap swings between 280 and 1080 MB, so the swing is promoted garbage waiting for a mark-compact.

## Scope

- `SearchScratch` holds g, h, f, deviation, came-from, heap index and open flag in typed arrays
  indexed by node, stamped by query as today; the open heap holds node ids.
- The ordering stays `betterRecord`'s total order on (f, h, dev, node), so every search returns the
  same path and the state hash is unchanged.

## Verify

- `ON_BENCH_PROFILE=alloc` from the reference's t100k checkpoint: `advance` KB per tick; a promotion
  profile and the mark-compact count over 2000 ticks against the numbers above.
- The pathfinding tests and goldens unchanged; state hash identical over a 2000-tick checkpoint run.
- `npm test`, `npm run check`.
