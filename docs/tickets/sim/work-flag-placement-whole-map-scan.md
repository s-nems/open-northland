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

Its hot caller chain is `economy/flags.ts` → `syncWorkFlagToJob` → `reidleAsJob` → `setJob`/`assignWorker`
(`orders/work.ts`) — i.e. **once per employment command**. A box-selected 50-settler `setJob` therefore
costs 50 whole-map scans *plus* 50 whole-world blocker rebuilds in a single tick, a routine player action
spiking tick time superlinearly in map size. `packages/sim/AGENTS.md` names ring search as the required
lever for nearest-X.

`evictWorkFlagsFromFootprint` (`economy/flags.ts`) is a second caller — once per flag a `placeBuilding`
encloses — but it is not the reason to do this: it early-outs before the scan unless a flag really is on
the new plot, which the sandbox acceptance scene never hits (measured 2026-07-17: zero calls over a full
run). Its worst case is bounded by the plot's `familyBody` (one flag per node), and real bodies are not
small — median 50 cells, max 388 (`content/ir.json`, 2026-07-17) — so a pathological placement onto a
flag-covered plot could burst to ~50 whole-map scans in one command tick. Still the same one-shot class as
the employment path, and fixed by the same ring search; do not size the work around this caller.

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
  `memoizedPlacementGrid` already establishes for the building rule) — **but not before**
  [`work-flag-move-stales-signpost-probe.md`](./work-flag-move-stales-signpost-probe.md) lands.
  `workFlagBlockerVersion` does not move when a flag MOVES (it keys on `componentGeneration(DeliveryFlag)`,
  which only sees add/remove), and unlike the signpost overlay's read-path memo, `canPlaceWorkFlag` is a
  command gate: memoizing it on that key today would make `setWorkFlag` accept or reject against a stale
  blocked set — a real sim decision, so a state-hash divergence rather than a cosmetic lie.

## Done when

- No whole-map loop on the `setJob`/`assignWorker` path below the cap.
- `npm test` green with **zero golden movement** (a moved golden means the winner changed).
