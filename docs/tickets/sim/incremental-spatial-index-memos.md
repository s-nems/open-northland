# Maintain the generation-keyed spatial index memos incrementally

**Area:** sim · **Origin:** goods-drop spatial-index review, 2026-07-17 · **Priority:** P2
(perf — no behavior change; canonical winners must stay byte-identical)

The three per-world spatial memos all rebuild **wholesale** when their component's store generation
moves, and all three key on a store that churns during normal play:

- `systems/region-index.ts` (`createRegionIndex` — the resource + berry indexes)
- `systems/footprint/resource-tile-cache.ts`
- `systems/stockpile-index.ts`

A generation bumps on every create/destroy of the keyed component, so one felled tree or one sown
field invalidates the whole ~17k-member resource index; the next read pays a full
`query + sort + per-member allocation + bucket insert`. That is fine when the read is once per tick
(`collectTargets`), but it degrades badly when reads interleave with creates inside the same
atomic-effect dispatch loop (`systems/agents/atomic.ts`) — `fellNode` destroys a `Resource`
(`effects-goods/harvest.ts:170,201,248`) and `applySow` adds one (`economy/farming.ts`) between reads.

**Measured** (throwaway profile over `dist/`, 200 successful sows, 17k resources): routing
`sowNodeOccupied`'s resource half through `resourcesNearNode` cost **1606ms → 4249ms (0.38x)** versus
the plain early-exiting store scan — the rebuild is strictly more work than the scan it replaces. So
`economy/farming.ts` deliberately kept the resource-half scan and only took the O(1) stockpile
lookup; its comment cites this ticket. The stockpile index has the same shape but stays a win on
realistic maps (heaps ≪ alive entities): ~8.8x at 500 stockpiles, ~1.5x at 6000, and ~2300x on the
memoized-read path the goods-drop ticket targeted — it only inverts when stockpiles approach the
alive count.

## Scope

- Maintain the memos incrementally: insert on create / remove on destroy, adopting the new
  generation, instead of rebuilding. Entity ids are monotonic and never reused, so an append keeps
  both the canonical list and every bucket ascending-id — no pick can move. Full rebuild stays the
  fallback when the generation moved by more than the tracked deltas.
- The three scaffolds are near-verbatim copies of each other (`WeakMap<World, {generation, …}>` +
  build + generation-gated verify + state-registers-verifier); the incremental fix would otherwise
  land three times. Extract the memo core once and let the payloads (region boxes, tile→good→entity,
  node buckets) ride it — `createRegionIndex` was already extracted for its second caller.
- Once the resource index is cheap to read mid-loop, restore `sowNodeOccupied`'s resource half onto
  it and drop the scan + the comment pointing here.

## Verify

- `npm test` — goldens byte-identical (an incremental index that moves a golden has changed a pick).
- `World.verifyCaches()` must still catch a stale index: extend each verifier to the incremental
  path, since a missed delta is the classic lockstep-desync source `cachesCoherent` exists to catch.
- Re-run the sow and drop profiles above: the sow path must beat the store scan, and the drop path
  must stop degrading as stockpile count grows.
