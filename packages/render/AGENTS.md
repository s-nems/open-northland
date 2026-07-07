# packages/render — drawing the world at RTS scale

`render` turns an immutable sim `snapshot()` into pixels with Pixi. It is a **pure projection**: it
reads the frozen snapshot + camera floats and never calls back into `sim` (root [`AGENTS.md`](../../AGENTS.md)
golden rules). Floats are fine here; determinism is the sim's. This file is the render-local contract —
the scale rules that keep a **very large map with thousands of bobs and up to 8 players** interactive.

## The one rule everything else serves: cost scales with the SCREEN, not the map

This is an RTS. The map may be huge (256² and up); the screen is small. **The DRAWN (GPU) per-frame
cost must be bounded by what's on screen, not the map size.** (The per-frame CPU *cull* is still an
O(entities) visibility pass — cheap per entity; a spatial index that makes the query itself O(visible)
is a future seam, see the last row.) We take this straight from
[OpenRA](https://github.com/openra/openra) — study it when a rendering question comes up, it's the
reference RTS renderer. Its shape, and our twin of it:

| OpenRA | Vinland | What it buys |
| --- | --- | --- |
| `Viewport` visible-cell region | `viewport.ts` `cameraViewport` (+ `visibleTileRange`, a provided utility) | the world-space box on screen, inverted from the camera |
| `TerrainSpriteLayer` drawn per visible region | `WorldRenderer` terrain **chunks** + per-chunk AABB `.visible` cull | a 1024² map draws the same few blocks a 64² one does |
| `ScreenMap` spatial index → renderable actors in box | sprite cull in `buildSpriteScene(snapshot, vp)` — an **O(entities) test** today, not a spatial query | draw ≈ on-screen bobs, not all bobs (`drawn ≪ entities`); a real `ScreenMap` index (query = O(visible)) is still TODO |
| Sprites batched by sheet; `PaletteReference` per player | one atlas source; character team colour = one indexed atlas read through a `256×N` LUT (`PalettedSprite`), other kinds batch by sheet | thousands of same-atlas bobs collapse to a few draw calls; all N player colours share ONE character atlas + LUT |
| Z-sorted renderables each frame | `spriteLayer.sortableChildren` + per-frame `zIndex` | correct iso depth without caching a moving value |

Concretely, that means:

- **Retained scene graph, never immediate mode.** Build display objects ONCE and mutate them; never
  `removeChildren()` + re-`new` per frame. `WorldRenderer` owns a persistent graph: terrain meshed in
  `setTerrain`, a **sprite pool keyed by entity id** (ids are monotonic — a stable key), a **texture
  cache** per atlas frame, and **one** `app.render()` per frame. The old immediate-mode `renderScene`
  churned one Pixi object per tile+entity every frame and crashed the tab past a couple thousand tiles.
- **Chunk + cull the terrain.** Terrain is static geometry, but a whole-map mesh still rasterizes
  off-screen ground every frame. Mesh it in `TERRAIN_CHUNK_TILES`-square blocks each with a world-space
  AABB, and each frame set `chunk.container.visible = intersects(aabb, viewport)`. Cost tracks the
  screen. **This was the fix that let terrain scale** (a whole-map single mesh pinned software-GL at 1fps).
- **Cull sprites to the viewport**; keep culled entities pooled (they scroll back), destroy only on
  death (left the snapshot). `reconcileSprites` is the pure, tested half of that bookkeeping.
- **Batch, don't fragment.** No per-sprite filters/masks/blend modes (they break Pixi's batcher). A simple
  whole-sprite team wash could ride `Sprite.tint` (a batch attribute), but the **player (team) colour** is a
  *band-limited palette remap* (only the clothing patches recolour, not faces/tools) — a flat tint can't do
  that. So character team colour uses `gpu/paletted-sprite.ts` (`PalettedSprite`): an **indexed** atlas read
  through a `256×N` player-colour LUT in a custom-shader `Mesh`. That mesh bypasses the batcher (one draw
  call each) — the accepted cost for a faithful ramp remap; keep it to characters, and the sim (not the GPU)
  is the battle-scale wall regardless. See docs/FIDELITY.md "Player (team) colours".
- **Bound the zoom-out** (`app/src/view/camera.ts` `MIN_ZOOM`). We deliberately do NOT support fitting a whole huge
  map on screen — the requirement is a big *battle-scale* view. The min zoom is the floor that bounds
  the visible tile + bob count. Lowering it needs a zoom-out LOD (marker quads + animation freeze), not
  just a smaller number.

## What an agent can and cannot verify here

Pixels + frame rate need a **human on a real GPU** (root `AGENTS.md` point 4/5). Headless Chromium is
**SwiftShader (CPU) WebGL** — absolute FPS runs ~50× low and is NOT a real-GPU signal (see the memory
`headless-render-fps-is-software-gl`). Use headless only for (a) no crash / no page errors and (b)
culling bites (`drawn ≪ entities` in the perf overlay).

**Before blaming the GPU, measure.** A slow scene is often not the renderer. Time `sim.step()` vs
`sim.snapshot()` vs `renderer.update()` separately (the stress scene once read `render=1.2ms` while
`step=2400ms` — the bottleneck was the sim's O(n²) target-finding, not the draw). The load-bearing
render DATA decisions ARE agent-checkable and unit-tested: `viewport.ts`, `buildSpriteScene`,
`reconcileSprites`, the frame selection in `sprites.ts`.
