# Draw the sprite layer from a retained mesh so a tick frame stops re-packing still sprites

**Area:** render · **Focus:** performance · **Priority:** P2

On `magiczny_las` at t120000 (six AI seats, the browser benchmark's widest view, zoom 0.35, about 6,800
sprites drawn) an x3 frame costs about 89 ms with the main thread at 4x CPU throttle, and Pixi's
instruction rebuild and execution are about 16 and 7 ms of it. About 770 settlers walk through about
119 depth bands (`gpu/depth-sorted-layer.ts`); their re-sorts (about 12 per frame) and band migrations
(about 13) rebuild every band each frame, and each rebuild re-collects and re-packs the roughly 5,500
still sprites in it and re-sends about 3.6 MB of batch buffer per frame. The scene build and the pool
already skip those still sprites (`IncrementalScene` in `data/scene/sprite-scene.ts`, the held-entity
skip in `gpu/sprite-pool/sprite-pool.ts`); only Pixi still walks them. A settler's binds are real work:
every walker layer changes frame each tick (about 2,040 sprite writes per tick frame for 550 binds), so
no layer cache removes them.

## Scope

1. **Still sprites from a retained mesh.** Draw the kept self-contained sprites of the spliced scene
   (the `kept` flags of `SpriteScene`) from a persistent page-multiplexed mesh with stable quad slots,
   as the terrain and decor chunks already draw (`gpu/page-samplers.ts`, `terrain/chunk-batcher.ts`,
   `map-objects/decor-batch.ts`), while movers stay on the Pixi path. Keep painter order exact: per
   band, the still run between two movers' depths is one index range of the mesh, drawn in band order
   between the movers' Pixi instructions. Measure the draws this adds per band before going further.
   Then movers, only if the first slice leaves a large remainder.
2. **Optional: decor animation on the GPU.** Every visible animated decor quad is rewritten and
   uploaded each tick (`animateDecorChunk`, about 4 ms per frame at 4x throttle, wide). Choosing the
   clip frame in the vertex shader from a per-quad phase, a tick uniform and a small frame-rectangle
   texture removes it.

### Map for scope item 1

- **Where a sprite's quad comes from.** `gpu/sprite-pool/bind-layers.ts` (`LayerBinder.bind`) sets each
  layer sprite's texture, position, scale, shear (`gpu/vegetation-sway.ts`), tint and alpha from the
  resolved layers (`resolved-layer.ts`, `layer-box.ts`); `placeShadow` projects cast silhouettes
  (`gpu/shadow-style.ts`); `bindPalettedQuad` binds a character layer as a `PalettedQuad`
  (`gpu/paletted-sprite/paletted-quad.ts`, texture from `TextureCache.palettedFrame`); a hidden slot
  takes `Texture.EMPTY` at zero alpha. The entity container stands at the interpolated feet
  (`present-entity.ts`). Anchor and trim come from the texture views `gpu/texture-cache.ts` mints.
- **What the shader reads per vertex.** `gpu/world-batcher.ts`: `WORLD_VERTEX_SIZE` 12 floats
  (position, uv, colour, texture id and round, flags, frame box, selection), packed by
  `packQuadAttributes`. The flags carry magnify (`isMagnifiedTexture`), shadow shading
  (`isShadowTexture`), paletted with LUT slot and row (`palettedLutOf`, `lutRow`) and glow; `aSelection`
  carries the selection light or `-1` for an outline stamp (`gpu/sprite-selection-effect.ts`). The
  fragment shader picks its page once per fragment (`pageColour`). A retained mesh must write the same
  attributes and use the same program, so magnify, shadows, paletted rows, glow and selection light
  draw as today.
- **What stays on the Pixi path.** Ship meshes (`PalettedSprite`), selection outline stamps
  (`sprite-pool/selection-effects.ts`), site markers and placeholders, the placement ghost, the world
  marks the sprite layer also holds (`world-renderer/world-marks.ts`: collapses, shots, family effects,
  badges) and the tall map objects (`map-objects/tall-blocks.ts`) until each is shown to fit.
- **Bands.** `DepthSortedLayer` files children by `zIndex` (`pooledDepth` in `sprite-pool.ts`) into
  32 px bands, each its own render group; `sortByDepth` and the migrant moves are what rebuild a band.
  Portrait insets and map views (`overlays/portrait-inset.ts`, `overlays/map-view.ts`) render the world
  layer under other cameras and must draw the mesh too.
- **Tests that pin today's picture.** `test/sprite-pool/*.test.ts` (binding, construction reveal,
  selection effects, paletted rows, held entities), `test/depth-sorted-layer.test.ts`,
  `test/world-batcher.test.ts`, `test/paletted-sampling.test.ts`, `test/scene/incremental-scene.test.ts`.

## Verify

- `npm run bench:browser-shots` before and after (`capture` with `ON_BENCH_SHOT_STEPS=20`, then
  `compare`): the world byte-identical at zoom 1, 0.5, 0.35 and 2 (run-to-run noise is about 10 pixels
  within 2/255 at zoom 1).
- `ON_BENCH_BROWSER_MODE=baseline ON_BENCH_BROWSER_WINDOWS=dense:3,wide:3
  ON_BENCH_BROWSER_CPU_THROTTLE=4 npm run bench:browser -- <t120000 checkpoint> <origin> <out> 12`, and
  the same unthrottled, interleaved against the base build: frame CPU, the `gl` draws, texture binds and
  upload KB, and the RAF p50, p95 and p99 at x3.
- A main-thread CPU profile of the wide view at x3 under the same throttle: `_buildInstructions` and
  instruction execution per frame before and after.
- `npm run check`, `npx tsc --build`, `npm run typecheck`, the render and app tests.
