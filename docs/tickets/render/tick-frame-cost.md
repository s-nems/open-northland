# Make a tick frame cost a small multiple of a still frame

**Area:** render · **Focus:** performance · **Priority:** P2

Every frame that takes in a sim tick re-emits, re-presents, re-sorts and re-submits the whole visible
scene, though most of it did not change. On `magiczny_las` at t120000 (six AI seats, the browser
benchmark's widest view, zoom 0.35, about 6,800 sprites drawn) a frame at x3 costs about 147 ms with
the main thread at 4x CPU throttle against 6.3 ms for a still frame, and about 30 ms per tick frame on
an M2 Pro, which shows as the stutter in the x3 RAF p95 and p99 rather than in the mean.

Per tick frame at 4x throttle, wide view: `SpritePool.presentPooled` about 19 ms (bind 7), Pixi
`_buildInstructions` about 20 ms and instruction execution about 9 ms, `sceneFor` about 10 ms. The scene
build already splices its self-contained items instead of re-emitting them (`IncrementalScene` in
`data/scene/sprite-scene.ts`; it still rebuilds in full when the view, the fog epoch or the
static-drawn set changes), and the pool already leaves untouched still sprites unvisited: a tick frame
presents about 1,650 of the 6,800 drawn and binds about 550, nearly all of them the walking settlers.
About 770 settlers walk through about 119 depth bands (`gpu/depth-sorted-layer.ts`): their re-sorts
and band migrations rebuild every band each frame, and each rebuild re-collects and re-packs the
roughly 5,500 static sprites beside them, re-sending about 3 MB of batch buffer per tick.

## Scope

In dependency order; measure each piece before starting the next.

1. **Settler presents.** Cache a settler's resolved layer set keyed on its rare inputs (job,
   equipment, carried good, palette row, action clip), so a tick that only advances the clip frame
   rewrites the sprite frames instead of re-resolving and rebinding every layer. Target: binds per tick
   frame near the number of settlers whose rare inputs changed.
2. **Own sprite-layer mesh.** Draw the sprite layer as a page-multiplexed mesh over the world batch
   shader, as the terrain and decor chunks already are (`gpu/page-samplers.ts`): stable vertex slots
   per sprite, painter order in a per-tick sorted index buffer, draws split where a run exceeds the
   batch's page slots, ranged uploads for rewritten slots. It must reproduce what the sprites draw
   today: anchor, trim, shear skew, projectile rotation, tint and alpha, paletted rows and glow, shadow
   and magnify flags, and selection stamps. Ship meshes (`PalettedSprite`) stay outside it. Build the
   smallest version that proves the saving (movers only, or one band) first.
3. **Optional: decor animation on the GPU.** Every visible animated decor quad is rewritten and
   uploaded each tick (`animateDecorChunk`, 5 ms per frame at 4x throttle, wide). Choosing the clip
   frame in the vertex shader from a per-quad phase, a tick uniform and a small frame-rectangle texture
   removes it.

Pixels stay as they are; a sub-level difference is stated in the commit.

## Verify

- `ON_BENCH_BROWSER_MODE=baseline ON_BENCH_BROWSER_WINDOWS=dense:3,wide:3,wide:0
  ON_BENCH_BROWSER_CPU_THROTTLE=4 npm run bench:browser -- <t120000 checkpoint> <origin> <out> 12`, and
  the same without the throttle: frame CPU, the `gl` draws, texture binds and upload KB per tick, and
  the RAF p50, p95 and p99 at x3 against the still frame.
- A main-thread CPU profile of the wide view at x3 under the same throttle: `presentPooled`,
  `_buildInstructions`, instruction execution and `sceneFor` per frame before and after.
- Paused screenshots at zoom 1, 0.5, 0.35 and 2 compared pixel by pixel before and after, with the
  pointer off the world.
- `npm run check`, `npx tsc --build`, `npm run typecheck`, the render tests.
