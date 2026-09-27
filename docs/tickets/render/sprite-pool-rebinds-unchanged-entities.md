# Skip the sprite pool's present and bind for an entity whose inputs held still

**Area:** render · **Focus:** gpu/sprite-pool · **Priority:** P2

`SpritePool.reconcile` (`gpu/sprite-pool/sprite-pool.ts`) runs `updatePooled`, which is
`presentEntity` plus `LayerBinder.bind`, for every visible draw item on every frame, then rewrites its
container's `zIndex`. Nothing short-circuits an entity whose draw item, animation frame, camera and
settings are the frame before's, so a paused game or a still camera over a quiet town pays the full
present and bind every frame.

Measured in the live late-game session (`docs/perf/heavy-load-krwawa-rzeka-12ai.md`, main-thread CPU, t82k,
1920x1080): paused with a still camera, the main thread is busy 43% of the time, about 7 ms a frame,
with `reconcile` 22% and `bind-layers.ts` `bind` 13% of it and nothing in the world changing; running
at speed 10, `updatePooled` is 20% of the main thread and `bind` 13%. The x3 budget for 120 FPS is
8.3 ms for the whole frame.

## Scope

- Measure first, with the trace or a page-side wrapper: how many items per frame change their draw
  item, frame index or screen placement between frames, paused and at x3 over a dense settlement.
- An entity whose inputs are unchanged since its last bind keeps its layers as they are: no present,
  no bind, no `zIndex` write. The key covers the draw item, the animation frame the gait or atomic
  clock selects, the camera transform and the settings that reach the layers.
- The painter order, fog gating and every layer's look stay identical.
- Say in the closing report whether the pooled count's growth (250 to 4277 entities as the camera
  visited every settlement in the reference run) affects per-frame cost; bound the retained pool only
  if it does.

## Verify

- Paused and still-camera main-thread ms per frame at the reference's t80k checkpoint against about
  7 ms; running at x3 over the same settlement, the `reconcile` share.
- `?shot` captures of a dense settlement pixel-identical before and after.
- `npm test`, `npm run check`, `npm run build`, and a human look at a live session.
