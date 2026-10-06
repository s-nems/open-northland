# Draw the walking settlers from the retained sprite mesh so a tick frame stops re-packing them

**Area:** render · **Focus:** performance · **Priority:** P2

On `magiczny_las` at t120000 (six AI seats, the browser benchmark's widest view, zoom 0.35, x3, main
thread at 4x CPU throttle) Pixi still spends about 12 ms per frame rebuilding the instructions of the depth
bands (`gpu/depth-sorted-layer.ts`) and about 9 ms executing them. The still sprites of held entities
already draw from the retained mesh (`gpu/still-mesh/`), which took the rebuild from about 17 to 12 ms
(render 30.2 to 25.9 ms per frame, measured in one session alternating the mesh on and off); what is
left is the walkers: about 770 paletted settlers re-sort and migrate between bands every tick, and each
band rebuild re-collects and re-packs their quads (about 1,000 mover sprites per frame) and splits the
batches around the mesh runs (draws 455 to 687 at zoom 0.35).

## Scope

1. **Paletted quads in the mesh.** Let the still mesh take `PalettedQuad` layers: a band table reserves
   the world batcher's LUT slot (`WORLD_FLAG_PALETTED`, `WORLD_LUT_SLOT_SHIFT` in `gpu/world-batcher.ts`)
   for the human palette LUT, and a quad's `lutRow` and `glow` changes reach its slot through the same
   Pixi update path a texture change does. Then make every non-paletted-mesh pooled entity eligible, not
   only held ones (`SpritePool.isHeld`): a mover's per-tick changes repack its slot in place, and only a
   re-sort or migration rewrites the band's indices, so the band's draws become one mesh draw per run of
   pooled entities instead of a Pixi batch per gap. Ship meshes (`PalettedSprite`), selection outline
   stamps, site markers, placeholders, the placement ghost, world marks and tall map objects stay on the
   Pixi path. Re-measure `RUN_PAYOFF` in `gpu/still-mesh/still-mesh.ts` once movers can join a run.
2. **Optional: decor animation on the GPU.** Every visible animated decor quad is rewritten and uploaded
   each tick (`animateDecorChunk`, about 4 ms per frame at 4x throttle, wide). Choosing the clip frame in
   the vertex shader from a per-quad phase, a tick uniform and a small frame-rectangle texture removes it.

Known limit, not a defect: a batch boundary moving changes a few edge pixels on Apple GPUs (2x2 clusters
of up to 6/255 where two sprites meet). Emulating the still runs' batch breaks with Pixi batches alone
gives the same pixels, so any change to where batches split shows it.

## Verify

- `ON_BENCH_SHOT_STEPS=5 npm run bench:browser-shots -- capture` before and after, observer and
  `ON_BENCH_BROWSER_SEAT=5`, then `compare`: the world identical at zoom 1, 0.5, 0.35 and 2 apart from the
  batch-boundary pixels above. With `RUN_PAYOFF` 0 every eligible run meshes from the first rebuild,
  which is the strict pixel check.
- An in-process A/B (one browser session alternating the mesh on and off every few seconds, at 4x
  throttle and unthrottled, zoom 0.35 and 1, x3): `app.render` time, `_buildInstructions` time and draws
  per frame. Separate benchmark sessions on a shared machine disagreed by more than the effect.
- `npm run check`, `npx tsc --build`, `npm run typecheck`, the render and app tests.
