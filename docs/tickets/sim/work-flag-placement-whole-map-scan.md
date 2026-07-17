# Replace `nearestWorkFlagPlacement`'s whole-map scan with a ring search

**Area:** sim · **Origin:** sim refactor-cleanup (deferred), 2026-07-17; narrowed 2026-07-17 after
the blocker-set memoization landed · **Priority:** P2
(perf — no behavior change; the canonical winner must stay byte-identical)

## Context

`nearestWorkFlagPlacement` (`packages/sim/src/systems/footprint/placement/work-flag.ts`) answers
"where is the nearest free node for this work flag?" with a linear scan of **every node on the map**:

```ts
for (let node = 0; node < terrain.nodeCount; node++) { … }  // ~1M nodes on a 512²-cell map
```

Its hot caller chain is `economy/flags.ts` → `syncWorkFlagToJob` → `reidleAsJob` → `setJob`/`assignWorker`
(`orders/work.ts`) — i.e. **once per employment command that hires a gatherer**. A box-selected
50-gatherer `setJob` costs 50 whole-map node scans in a single tick; measured on magiczny_las
(2026-07-17), the strategic AI's opening collector hires spent ~130 ms in one command tick mostly here.
`packages/sim/AGENTS.md` names ring search as the required lever for nearest-X.

The blocker-set half of the original ticket is DONE: `workFlagPlacementBlocks` is now a layered view —
a standing layer (resources/buildings/signposts) memoized on `placementBlockerVersion` plus a fresh
tiny `DeliveryFlag` marker set — so only the node loop itself remains expensive.
`evictWorkFlagsFromFootprint` (`economy/flags.ts`) is a second caller, bounded by the enclosed-flag
count; the same ring search fixes it.

## Why this wasn't done in the refactor pass

The fix is an expanding Manhattan-ring walk from the origin. That walk is **already hand-inlined in
several places**, which is exactly what [`manhattan-ring-enumeration-helper.md`](./manhattan-ring-enumeration-helper.md)
and [`ring-iteration-iterator.md`](./ring-iteration-iterator.md) exist to fix — writing another copy
here would deepen the duplication those tickets track. `nav/nearest.ts`'s `nearestUnblockedNode` is not
a drop-in either: it is a BFS over walkable adjacency, whereas this rule ranks by pure Manhattan
distance and ignores connectivity.

Do the ring-enumerator extraction first, then land this on top of it.

## Scope

- Expand Manhattan rings from `origin` using the shared enumerator, bounded by a named cap (see
  `family/food-search.ts`'s `RING_MAX_RADIUS` for the convention), keeping the whole-map loop as the
  documented fallback past the cap.
- Preserve the tie-break exactly: `(distance, then lowest node id)`. Within a ring, enumerate in
  ascending node id so the first hit *is* the canonical winner — goldens must not move.

## Done when

- No whole-map loop on the `setJob`/`assignWorker` path below the cap.
- `npm test` green with **zero golden movement** (a moved golden means the winner changed).
