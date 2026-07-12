# Bundle the terrain/field build signatures (GridDims + TerrainBuildContext)

**Area:** render · **Origin:** /refactor-cleanup on packages/render, 2026-07-12

Two families of parameters always travel together through the terrain + per-cell
field builders and should collapse into a domain object, per the "sprawling
signature" cleanup. Deferred from the render pass as its own coherent change.

## Scope

- **`GridDims { width, height }`** — the `(width, height)` pair is threaded through
  `data/terrain.ts` `nodeLift(liftAt, hx, hy, width, height)` and
  `nodeLaneUV(hx, hy, width, height, paddedWidth)`, and `data/cell-field.ts`
  `makeCellSampler(values, width, height)`, `data/elevation.ts`
  `makeElevationField(elevation, width, height)`, `data/brightness.ts`
  `makeBrightnessField(..., width, height)`. Introduce a `GridDims` type and thread
  it through the call chain. (The `(pageW, pageH)` pair in `triangleUVs`/`rectTriangleUVs`
  is a smaller instance of the same shape — fold it in or leave it, reviewer's call.)
- **`TerrainBuildContext`** — `gpu/terrain/terrain-layer.ts` `buildTextured`,
  `buildGround`, `buildFlat`, and `pushTriangle(batch, nodes, uvs, lift, shaded, terrain)`
  all thread `(terrain, lift, shaded[, laneTexWidth])` and re-derive `lift`/`shaded`
  from the same inputs. Collapse into a per-build `TerrainBuildContext`.

Behavior-preserving parameter-object refactor; no logic change.

## Verify

`npm run build`, `npm test` (terrain/elevation/brightness/chunk-batcher suites),
`npm run check`. Terrain is visual — a `npm run shot` sanity check that the ground
still renders, but no golden should move.
