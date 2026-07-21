# Split the sprite pool's per-entity bind half out of sprite-pool.ts

**Area:** render · **Origin:** /refactor-cleanup on packages/render, 2026-07-17 · **Priority:** P3

`gpu/sprite-pool/sprite-pool.ts` is **547 lines** after the 2026-07-17 pass moved the portrait protocol
out (`portrait-subject.ts`, −31) and trimmed its comments (−14). It is the last render file well over the
~300-line budget besides `world-renderer.ts` (473, same story), and unlike that one it is dense logic, not
passthroughs.

The folder is already correctly split for the *pure* halves (`motion`, `reconcile`, `resolve-layers`,
`pick`, `placeholder`, `alpha-mask`). What is left unsplit is the Pixi-mutating half, which holds two
genuinely separate jobs:

- **"which entities are on the layer this frame"** — `reconcile`, the attach/detach passes, the death reap;
- **"what does one entity's sprite stack look like this frame"** — `bindLayers` + `showPlaceholder` +
  `stampBounds` + `entityTint` + `CONSTRUCTION_REVEAL_EASE` + `layerHasReveal`, ~215 lines and the densest
  logic in the folder.

## Scope

Extract the second job into `sprite-pool/bind-layers.ts` as a free function
`bindLayers(pe, item, layers, frame, ctx)` where `ctx` carries `{ textures, sheet, frameId }`.
`sprite-pool.ts` then retains `PoolFrame`, `SpritePool`, `reconcile`, `updatePooled`, `placePalettedFor`
(~280 lines); `bind-layers.ts` lands ~230.

**The seam is the risk (medium, not mechanical).** `bindLayers` mutates `pe.reveal`, `pe.shadowFlags`,
`pe.bounds`, `pe.sprites` and reads `this.frameId`/`this.textures`/`this.sheet` — those must be passed
explicitly rather than captured. It is the per-frame hot path, so the parameterization must not add a
per-sprite allocation.

**Pairs with:** `resolve-layers.ts` (410 lines) is also over budget and is a candidate feature-subfolder
split (`resolve-layers/{index,resolved-layer,atlas-lookup,building,decor,character}.ts`, dispatcher ~90
lines). It reads fine today and is cohesive — it is only worth splitting **as part of this change**, so the
folder's shape stays coherent. Standalone it is churn.

## Verify

`npm run build`, `npm test` (sprite-pool, reconcile, motion, scene suites — all under `test/sprite-pool/`),
`npm run check`; re-read both resulting modules to confirm each owns one of the two responsibilities
above. Behaviour-preserving — no golden moves. Bodies move verbatim; any rename rides its own hunk.
