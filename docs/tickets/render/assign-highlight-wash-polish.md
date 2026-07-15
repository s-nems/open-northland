# Soften the workplace-assignment building highlight (per-cell mesh reads busy)

**Area:** render · **Origin:** przydziel-miejsce-pracy UI, 2026-07-15 · **Priority:** P3

The "przydziel miejsce pracy" highlight (`BuildingHighlightLayer`,
`packages/render/src/gpu/overlays/building-highlight.ts`) washes each candidate building's footprint by
drawing a stroked green/red diamond per footprint cell. Over a real building's dense art the per-cell
diamonds + strokes read as a busy mesh rather than the "lekko zielone / lekko czerwone" (slightly green /
slightly red) tint the feature intends.

## Scope

- Make the wash read as one soft translucent green/red field per building instead of a grid of stroked
  diamonds — e.g. drop the per-cell stroke and composite the footprint fill off-screen so neighbouring
  cells fuse (the `PlacementOverlayLayer` half-resolution composite is the precedent), or tint the
  building sprite itself (`Sprite.tint`, batch-friendly per render AGENTS.md) rather than washing cells.
- Keep it a pure projection fed the same `BuildingHighlightItem[]` (ok/no + cells) — the app-side
  `computeAssignHighlight` verdict does not change.
- Human eyes on the result over real content (the wash must stay legible as green vs red without hiding
  the building).

## Verify

- Headless: no crash, the layer still rebuilds only on `set`.
- Browser `?scene=sandbox`: select a settler → "przydziel miejsce pracy" → the candidate buildings read
  as a soft green/red tint, not a diamond grid. **User's eyes.**
