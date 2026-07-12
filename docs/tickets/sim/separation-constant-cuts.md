# Cut separationSystem constants: numeric NodeBuckets keys + reused scratch structures

**Area:** sim · **Origin:** sim-perf plan reconciliation, 2026-07-12

Profiled 2026-07-11 (throwaway `SYSTEM_ORDER` timer over `dist/`): 2000 owned civilian walkers in
dense two-way cross-traffic = **16.3 ms/tick in `separationSystem`** (worst-case stress; realistic
towns sit far lower — 60 converging fighters = 0.44 ms/tick). Costs are allocation/keying, not pair
math. Two winner-identical cuts:

1. **Numeric `NodeBuckets` keys.** `NodeBuckets` keys every node with the string
   `nodeKey(x,y)` = `` `${x},${y}` `` (`nav/geometry.ts` ~L13, used in `systems/spatial.ts`) —
   9–18 string builds per mover per tick across all consumers (combat, flee, jobs, ai spacing,
   separation post/mover indexes).
   **Correctness gate, not just a speed swap:** `geometry.ts`'s doc *deliberately* uses a string
   key so a negative/off-map coordinate can never alias onto a real node the way a naive
   `y*width+x` packing would — and `NodeBuckets.nearest`/`.at` do probe off-map neighbours
   (`fromX±d`). Also `nodeKey` is consumed directly by `placement.ts` obstacle/exclusion sets.
   So either give `NodeBuckets` its own collision-free numeric packing that tolerates
   negative/off-grid coords (offset-biased) while `placement.ts` keeps the string key, or migrate
   both.
2. **Reused scratch structures in `movement/collision/separation.ts`:** per-mover
   `nearMovers`/`nearPosts` arrays (~L222–223) and the per-tick `before` map of fresh
   `{x,y,hx,hy}` objects (~L164–169) become reused scratch.

The two cuts are independent — if the numeric-key negative-coord safety proves fiddly, land the
scratch-array reuse (self-contained in `separation.ts`) separately.

## Verify

- `npm test` — goldens byte-identical (winner-identical refactor).
- Same throwaway stress probe before/after (2000 walkers cross-traffic).
- Determinism + perf review lenses on merge.
