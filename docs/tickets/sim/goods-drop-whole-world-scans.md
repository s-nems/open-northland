# Replace the goods-drop whole-world scans with the spatial index

**Area:** sim · **Origin:** bug-hunt review, 2026-07-17 · **Priority:** P2
(perf — no behavior change; canonical winners must stay byte-identical)

`dropOrStackGood` (`packages/sim/src/systems/agents/effects-goods/piles.ts:42-58`) and
`stackOntoTile` (`piles.ts:74-98`) each iterate `world.canonicalEntities()` — every alive entity; a
decoded map holds ~17k resource nodes plus bushes/settlers — just to find the heap on one tile.
Every flag-gatherer bank (`pileupIntoStore` → `dropCarryAtOwnTile`, `carry.ts`) and every porter
shed deposit pays one full scan; worse, `dropCarriedLoad` (`carry.ts:88-127`) calls `stackOntoTile`
once per ring node while a remainder is carried — up to ~2,100 nodes over the 32-radius Manhattan
rings — so a single forced drop into a saturated yard is O(ring-nodes × entities), ~10⁷–10⁸
component checks in one tick.

Same pattern: `sowNodeOccupied` (`systems/economy/farming.ts:76-86`) rescans the full
`Resource+Position` and `Stockpile+Position` stores on every completed sow swing, even though the
planner already builds a per-tick occupancy index for exactly this (`FarmClaims.sowScan`,
`farming/targets.ts:130-145`) and `collectTargets` builds `yard.occupied` for the yard case.

Determinism is unaffected (the scans do membership/first-on-tile checks over canonical order), but
this is the per-unit whole-world scan the package contract bans; `NodeBuckets` /
`NodeBuckets.nearest` (`systems/spatial.ts`) is the sanctioned lever.

## Scope

- Route the tile-occupancy lookups in `dropOrStackGood`/`stackOntoTile` through a spatial index
  (existing `NodeBuckets` or a stockpile-by-node index — `systems/` already indexes standing
  resources by tile for the ground-drop join, commit a20d39ee; mirror that approach).
- Reuse the existing per-tick occupancy indexes for `sowNodeOccupied` instead of the store rescans.
- Preserve pick order exactly: same heap chosen for stacking, same first-free ring node. Goldens
  must not move — a moved golden means the pick changed.
- Register any new incrementally-maintained cache in `World.verifyCaches()`.

## Verify

`npm test` (goldens byte-identical), `npm run check`, `npm run build`. Optional: throwaway `dist/`
profile of a saturated-yard forced drop before/after (see `docs/tickets/sim/perf-benchmark-harness.md`).
