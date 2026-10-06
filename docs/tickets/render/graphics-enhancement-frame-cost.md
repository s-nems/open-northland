# Reduce measured graphics enhancement and presentation costs

**Area:** render · **Focus:** performance · **Priority:** P2

Enhanced sampling is most of the GPU frame: on `magiczny_las` at t80000 the main stage takes about
5.5 ms at zoom 1 with it on and 2.0 ms with it off (M2 Pro, GPU timer query around the main Pixi
stage), and the sprite layer about 3.3 ms of that. The world batch shader now picks a fragment's page
once and passes the sampler down (`gpu/world-batcher.ts`, `gpu/pixel-art-magnify.ts`); the costs below
remain. Improve measured frame cost across hardware without changing simulation speed, population or
gameplay rules. The tick-frame CPU cost of the sprite layer is
[tick-frame-cost.md](tick-frame-cost.md), not this ticket.

## Scope

Measure first, then fix only what the numbers justify, interleaving the sides as `docs/DEVELOPMENT.md`
describes.

- **Palette LUT chain per tap** (`gpu/world-batcher.ts`). A paletted character's every tap still walks
  the sampler if-chain for its LUT slot (`fetchLut`): up to 16 lookups per minified fragment, 16 more
  per xBR one. Give the LUT a fixed batch texture slot so the lookup indexes a constant sampler. The
  size query (`textureSizeOf`) still walks the chain once per fragment, and a ship's paletted mesh
  (`gpu/paletted-sprite/shader.ts`) re-reads `textureSize` on every tap.
- **Four-tap minify at zoom 1 and below.** A minified fragment samples four clamped taps, which land
  on one point when the footprint is under a texel. At zoom 1 rounding sends some unscaled sprites to
  the xBR magnifier and others to the minifier, and which one can change with any rebuild of the shader.
  Taking every footprint within 0.001 of one texel per pixel through a single 1:1 tap makes zoom 1
  deterministic and cheaper but moves about 1% of the zoom-1 pixels; it needs an owner ruling on the
  pictures before it lands.
- **Baseline vertex cost** (`gpu/world-batcher.ts`). `WORLD_VERTEX_SIZE` is 12 floats against Pixi's 6,
  so every world quad uploads 192 bytes instead of 96, and the packer does a WeakMap and up to two
  WeakSet lookups and a frame box per packed element with every enhancement off. `aFrame` is read only by
  the magnify and minify branches.
- **Program link on a live scaler change** (`gpu/world-batcher.ts`). Programs compile lazily inside the
  draw call, and the batch program now inlines its page shading once per texture slot, so the first
  frame after the player changes the filter links a larger program mid-frame. Warm the programs when the
  enhancement settings change if the hitch is visible.
- **Per-frame churn with environment motion on** (`gpu/map-objects/map-object-layer.ts`). `motionTime`
  is `tick + alpha`, so the frame-identical early-out never fires and every visible swaying tall object
  rebinds each frame, including its shadow sprite. Confirm it is affordable on a forested map.
- **Flat decor shadow fill** (`gpu/map-objects/decor-shadow-shader.ts`). The blur is 36 texel fetches per
  fragment. Settle it on a named decor-dense map.
- **Per-frame allocation** (`gpu/sprite-pool`, `data/scene`). At t80000, x3, the main thread allocated
  about 600 KB per frame in the dense view and 770 KB in the widest (allocation sampling with collected
  objects, before the still-frame and combat-mark changes). The render share: the pool's `reconcile`
  25 KB (dense) and 145 KB (widest), `presentItem` about 24 KB and `assembleItem` about 25 KB per frame;
  the rest is the snapshot delta path and Pixi. Trace the stacks before retaining further reveal and
  layer-offset records on `PresentationTrack`, and keep the binder's stamp semantics: a mutable retained
  record must not make a changed layer look unchanged.

## Verify

- A numbered before/after on one real map at x3, each enhancement on and off, with the GPU timer query
  of the browser benchmark's profile mode and the load average reported.
- `npm run bench:browser` draw, texture-bind and upload counts (`gl`) for a town view with enhanced
  shadows on and off.
- Allocation sampling (`HeapProfiler.startSampling` with collected objects) at x3 on the same map.
- Paused screenshots compared pixel by pixel: the default render stays byte-identical to the control
  capture unless an owner ruling accepts the change.
- `npm run check`, `npm run build`, `npm test`.
