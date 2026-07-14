# Route the remaining economy nearest-X scans through `InteractionCellIndex`

**Area:** sim · **Origin:** /refactor-cleanup on packages/sim, 2026-07-14 · **Priority:** P3
(refactor / dedup + perf — no behavior change)

## Context

`InteractionCellIndex` (`packages/sim/src/systems/agents/targets/cell-index.ts`, landed with the
economy-ring-index work) is the shared seam for the economy nearest-X picks: it owns the
`interactionCell` / `manhattan` / `closer` `(distance, cell-id, entity-id)` loop, buckets
seeker-independent (building-door) candidates for an expanding node-ring search, and folds in a
linear tail for the seeker-dependent ones (boat hulls, ground piles, resource work cells) so the
winner is byte-identical to a full linear scan for any candidate mix. Three scans already route
through it (`nearestTemple`, `nearestStoreFor`, `nearestConstructionSite`,
`nearestConstructionSiteNeeding`), built once per tick as `TargetCandidates.{stockpile,building,constructionSite}Cells`.

The remaining scans still open-code the same `best = null` / `bestDist = +∞` / `bestCell = +∞`
loop with the shared `closer` tie-break. They fall in two groups:

- **Building-dominated (a ring win + dedup):** `nearestWorkplaceOutput` (`targets/stores/outputs.ts`),
  `nearestFoodStore` (`targets/food.ts`), `nearestStoreHolding` (`targets/stores/stock.ts`),
  `nearestMissingInputSource` (`agents/economy/workshop/supply.ts`). Their non-building candidates
  (food/flag piles) already fall into the index's seeker-dependent tail, so the winner stays
  byte-identical — the wiring cost is a per-scan good-derivation on the winner (each returns a
  `{ store/workplace, goodType }`-shaped value, not a bare entity) and a fresh golden run.
- **Pile/resource-dominated (dedup only, no ring win):** `nearestCollectablePileFor` /
  `nearestOwnDropFor` / `nearestHarvestableFor` (`targets/resources.ts` ×3),
  `nearestGroundPile` (`agents/economy/haul-targets.ts`), the farming pick
  (`agents/farming/targets.ts`). These are almost all seeker-dependent, so a ring buys nothing; route
  them through the index's linear path (or a small exported `nearestByCell` linear helper sharing
  the same loop) purely to delete the duplicated skeleton.

## Scope

- Give `InteractionCellIndex.nearest` (or a sibling) the shape each caller needs: it returns
  `{ entity, cell, distance }`, which already covers the entity/`{store,goodType,dist,cell}` callers;
  confirm `nearestWorkplaceOutput`'s per-workplace good pick reproduces on the returned winner.
- Route the building-dominated scans through the existing per-tick indexes (add
  `groundDrops`/farming indexes only where a scan needs its own candidate list).
- Dedupe the pile/resource scans against the same loop without changing their linear cost.
- Preserve the `(distance, cell-id, entity-id)` winner verbatim — a moved golden means the pick changed.

## Verify

- `npm test` — goldens byte-identical; fuzz-determinism, invariants, hygiene scan.
- `npm run check`, `npm run build`.

## Also worth folding in

The three cell indexes are built eagerly in `collectTargets` every tick even when no settler queries
them (cost is O(candidates), bounded by map not settlers², so it is within budget). If a perf pass
wants it, make the build lazy-per-tick (a memo on `TargetCandidates`, like `FarmClaims.sowScan`).

## Source basis

Pure internal refactor — no mechanic, extraction, or visual claim. The `(distance, cell-id, entity-id)`
winner to preserve is pinned by the `closer` helper and the economy goldens.
