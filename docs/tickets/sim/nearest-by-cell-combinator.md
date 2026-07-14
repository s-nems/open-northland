# Extract a `nearestByCell` combinator for the economy nearest-X scans

**Area:** sim · **Priority:** P3 (refactor / dedup — no behavior change)

## Context

The economy target scans repeat one loop skeleton ~14 times across 9 files: seed
`best = null`, `bestDist = +∞`, `bestCell = +∞`; for each candidate apply a per-scan filter,
compute `interactionCell(world, ctx, terrain, e, here)` and `manhattan(terrain, here, cell)`, and
keep the winner via the shared `closer(dist, cell, bestDist, bestCell)` tie-break. Only the filter
and the returned value shape differ.

Sites (grep `closer(dist, cell, bestDist, bestCell)` + `let bestCell = Number.POSITIVE_INFINITY`,
14 hits): `agents/targets/resources.ts` (×3), `agents/targets/stores/stock.ts` (×2),
`agents/targets/stores/buildings.ts` (×2), `agents/targets/stores/outputs.ts`,
`agents/targets/food.ts`, `agents/economy/haul-targets.ts`, `agents/economy/routing.ts`,
`agents/economy/workshop/supply.ts`, `agents/farming/targets.ts`.

Surfaced during the sim refactor-cleanup pass (2026-07-14) and deferred: it is the largest change in
that area and determinism-sensitive, so it wants its own scoped pass rather than riding a broader one.

## Scope

- Add a `nearestByCell(candidates, world, ctx, terrain, here, pick)` combinator where
  `pick(e) => { cell, value } | null` folds each scan's filter + returned value; the combinator owns
  the `interactionCell` / `manhattan` / `closer` loop. Return the winning `value` (or null).
- Route the 14 scans through it, each supplying only its filter/value closure. The `closer`
  `(distance, then cell-id)` tie-break and the `interactionCell` measurement must be preserved
  verbatim so the winner is byte-identical.
- The `pick` return-value variance is the reason for care: some scans return the entity, some
  `{ pile, goodType }`, some `{ entity, cell, dist }` — the combinator must be generic over that shape.

## Verify

- `npm test` — goldens byte-identical; fuzz-determinism, invariants, hygiene scan. A moved golden
  means the scan order or tie-break changed.
- `npm run check`, `npm run build`.

## Relation to `economy-ring-index.md`

That ticket replaces these same linear scans with an interaction-cell ring index for performance
(and would move goldens without its cell-bucketed variant). This ticket is the orthogonal
behavior-preserving dedup of the current linear form. Whoever lands the ring index first should fold
this in rather than doing both blindly; if this lands first, the combinator is the natural seam the
ring index slots behind.

## Source basis

Pure internal refactor — no mechanic, extraction, or visual claim. The `(distance, cell-id)` winner
to preserve is pinned by the existing `closer` helper and the economy goldens.
