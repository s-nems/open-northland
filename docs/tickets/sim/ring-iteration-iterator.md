# Extract a shared expanding-Manhattan-ring node iterator

**Area:** sim · **Priority:** P3 (refactor / dedup — no behavior change)

## Context

The expanding-Manhattan-ring walk — `for d = 0..maxR`, `for dx = -d..d`, `rem = d - |dx|`, the two
rows `dy = ±rem` tracing the diamond, return at the first non-empty ring — is now written out three
times, with the ring-geometry comment copied between two of them:

- `packages/sim/src/systems/spatial.ts:112-143` — `NodeBuckets.nearest` + `pickMinId` (combat/herding
  nearest-entity, `(distance, entity-id)` pick).
- `packages/sim/src/systems/agents/targets/cell-index.ts` — `InteractionCellIndex.ringNearest` +
  `pickInRing` (economy nearest-X, `(distance, cell-id, entity-id)` pick, bbox-bounded radius).
- `packages/sim/src/systems/agents/targets/stores/stock.ts:146-157` — `nearestFreeYardNode` (nearest
  free yard tile around a flag).

Only the per-node pick differs (min entity-id vs min cell-id vs first-free-walkable tile); the ring
math is identical. The three classes stay separate for good reasons (different tie-breaks, documented
in each), but the iteration skeleton itself is genuine copy-paste.

## Scope

- Add a `forEachRingNode(cx, cy, maxRadius, visit)` (or a generator `ringNodes(cx, cy, maxRadius)`)
  in `systems/footprint/geometry.ts` or `spatial.ts` that yields each node at Manhattan distance
  `0..maxRadius` in ascending-distance order, diamond rows in the current order.
- Route all three call sites through it, each keeping only its per-node/per-ring pick. The
  ascending-distance visit order and the two-rows-per-`dx` traversal must be preserved verbatim so
  every winner stays byte-identical.

## Verify

- `npm test` — goldens byte-identical (a moved golden means the visit order changed); fuzz-determinism,
  invariants, hygiene scan.
- `npm run check`, `npm run build`.

## Source basis

Pure internal refactor — no mechanic, extraction, or visual claim. The ring visit order to preserve
is pinned by the combat and economy goldens.
