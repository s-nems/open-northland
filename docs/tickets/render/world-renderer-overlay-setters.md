# Collapse WorldRenderer's near-identical overlay setters

**Area:** render · **Origin:** /refactor-cleanup on packages/render, 2026-07-12

`gpu/world-renderer.ts` is a 460-line orchestrator/facade. Beyond the `update`
signature (already fixed → `WorldFrame`), it carries four near-identical world-space
overlay setters — `updatePlacementOverlay`, `updateConstructionPlots`,
`updatePlacementGhost`, `setGeometryDebug` — each just "store a frame, pass
`this.elevation` to the layer". They share one shape and could collapse to a single
generic `overlay.set(frame, elevation)` seam, cutting the passthrough surface.

Optional second half (lower priority): the fog memory / view / static-handover
coordination (`fogView`, `fogGhosts`, `staticDrawnRefs`, `updateFog`,
`adoptFogGhost`, `setStaticallyDrawnRefs`, `removeMapObject`) is one cohesive
"viewer memory" concern smeared across several one-line methods; grouping it would
further slim the facade. Keep it a separate, clearly-separable hunk if attempted.

## Scope

Unify the four overlay setters behind one generic layer-set shape (or a small
`OverlayLayer` interface the four layers implement). Preserve the exact per-frame
"skip when unchanged" behavior each layer already has. Do NOT change draw order or
the z-wiring in the constructor.

## Verify

`npm run build`, `npm test` (world-renderer, placement-overlay suites), `npm run check`.
Overlays are visual — `npm run shot` of a build-placement scene to confirm the dim
wash / ghost / construction plots still draw; human sign-off on the overlays.
