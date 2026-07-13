# Point seeker-independent economy nearest-X scans at an interaction-cell ring index

**Area:** sim · **Origin:** sim-perf plan reconciliation, 2026-07-12 · **Blocked by:**
[economy-sink-memo](economy-sink-memo.md) · **Priority:** P2

The economy nearest-X picks are still linear candidate-list scans, `O(idle·candidates)` per tick,
now spread across `agents/targets/stores/*` (`nearestStoreFor`, `nearestStoreHolding`,
`nearestFreeYardNode` in `stock.ts`; `nearestWorkplaceOutput` in `outputs.ts`; `nearestTemple`,
`nearestConstructionSite` in `buildings.ts`), `agents/targets/food.ts` (`nearestFoodStore`),
and `agents/economy/*` (`nearestMissingInputSource`, `workplaceOutputToHaul` in `workshop/supply.ts`;
`nearestGroundPile`, `boundProducerOutputToHaul` in `haul-targets.ts`). `NodeBuckets.nearest`
(`systems/spatial.ts`) already does the canonical band search combat uses.

**Golden-safety analysis (pinned 2026-07-08, re-verified against code 2026-07-12):** a *plain*
migration moves goldens. These scans measure distance to each candidate's **interaction cell**
(`interactionCell` — door node / `resourceWorkCell` / blocked-anchor fallback) and tie-break by
**cell id** via the shared `closer(dist, cell, …)`, not the candidate's own tile + entity id that
`NodeBuckets.nearest` uses; and `resourceWorkCell`/`positionedInteractionCell` take a `from` arg
(seeker-dependent), so those candidates cannot be pre-bucketed at all.

## Scope

- An interaction-tile-bucketed ring variant with a `(distance, cellId, entityId)` pick for the
  **seeker-independent** scans (`nearestTemple`, the building-only store scans).
- A bounded radius + linear fallback (an unbounded ring miss walks the whole map).
- Leave the seeker-dependent scans (`resourceWorkCell` / blocked-anchor pile fallback) linear.

## Verify

- `npm test` — goldens byte-identical; fuzz-determinism, invariants, hygiene scan.
- Before/after ms/tick at a few thousand settlers (throwaway timer over `dist/`).
- Determinism + perf review lenses on merge.
