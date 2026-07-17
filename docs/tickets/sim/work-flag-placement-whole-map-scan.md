# Replace `nearestWorkFlagPlacement`'s whole-map scan with a ring search

**Area:** sim · **Origin:** sim refactor-cleanup (deferred), 2026-07-17 · **Priority:** P2
(perf — no behavior change; the canonical winner must stay byte-identical)

## Context

`nearestWorkFlagPlacement` (`packages/sim/src/systems/footprint/placement/work-flag.ts`) answers
"where is the nearest free node for this work flag?" with a linear scan of **every node on the map**:

```ts
const blocked = workFlagPlacementBlocks(world, ctx.content, terrain); // full Resource/Building/DeliveryFlag/Signpost walk
for (let node = 0; node < terrain.nodeCount; node++) { … }            // ~1M nodes on a 512²-cell map
```

Its caller chain is `economy/flags.ts` → `syncWorkFlagToJob` → `reidleAsJob` → `setJob`/`assignWorker`
(`orders/work.ts`) — i.e. **once per employment command**. A box-selected 50-settler `setJob` therefore
costs 50 whole-map scans *plus* 50 whole-world blocker rebuilds in a single tick, a routine player action
spiking tick time superlinearly in map size. `packages/sim/AGENTS.md` names ring search as the required
lever for nearest-X.

`canPlaceWorkFlag` in the same file has the same shape: it rebuilds the entire blocked set to answer a
question about one node.

## Why this wasn't done in the refactor pass

The fix is an expanding Manhattan-ring walk from the origin. That walk is **already hand-inlined in three
places**, which is exactly what [`manhattan-ring-enumeration-helper.md`](./manhattan-ring-enumeration-helper.md)
and [`ring-iteration-iterator.md`](./ring-iteration-iterator.md) exist to fix — so writing a fourth copy
here would deepen the duplication those tickets track. `nav/nearest.ts`'s `nearestUnblockedNode` is not a
drop-in either: it is a BFS over walkable adjacency, whereas this rule ranks by pure Manhattan distance
and ignores connectivity.

Do the ring-enumerator extraction first, then land this on top of it.

## Scope

- Expand Manhattan rings from `origin` using the shared enumerator, bounded by a named cap (see
  `family/food-search.ts`'s `RING_MAX_RADIUS` for the convention), keeping the whole-map loop as the
  documented fallback past the cap.
- Preserve the tie-break exactly: `(distance, then lowest node id)`. Within a ring, enumerate in
  ascending node id so the first hit *is* the canonical winner — goldens must not move.
- Memoize `canPlaceWorkFlag`'s blocked set per `workFlagBlockerVersion` (the pattern
  `memoizedPlacementGrid` already establishes for the building rule).

## Done when

- No whole-map loop on the `setJob`/`assignWorker` path below the cap.
- `npm test` green with **zero golden movement** (a moved golden means the winner changed).
