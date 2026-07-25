# Stop SelectionLayer scanning every entity each frame

**Area:** render (gpu/overlays) · **Priority:** P2

While anything is selected, `SelectionLayer.reconcile` iterates `frame.snapshot.entities` in full
to find the positions of the selected ids (`for (const ent of frame.snapshot.entities) { if
(!ids.has(ent.id)) continue; ... }`), and `draw` runs the reconcile once per pool (selection
rings, then flag rings), every frame. Per-frame cost scales with total map entity count times the
number of non-empty pools, which violates the render contract (draw cost follows the viewport and
the work, not map size). An empty set skips its scan, so the cost appears exactly when the player
is interacting.

The loop body already uses the right seams (`readPosition`, `classify`, `feetAnchor` over
`frame.drawn`); what is missing is an id-keyed position lookup, so the scan is the workaround.

## Scope

- Invert the iteration: walk the selected/flagged id sets (bounded by selection size) and resolve
  each id through a memoized id → entity/position lookup in `snapshot-index.ts` (same shape as
  the existing `targetPositionsOf`), falling back per current semantics when an id has left the
  snapshot.
- Non-goal: changing ring visuals, retirement semantics, or selection behavior.

## Verify

A unit test proving the id-keyed lookup resolves the same positions the full scan produced,
including a building and a despawned id. `npm test`, `npm run check`, `npm run build`. Human
seam: select settlers and a building in `?scene=sandbox`; rings and flag rings unchanged.
