# Reduce measured graphics enhancement and presentation costs

**Area:** render · **Focus:** performance · **Priority:** P2

Enhanced sampling is most of the GPU frame: on `magiczny_las` at t80000 the main stage takes about
5.5 ms at zoom 1 with it on and 2.0 ms with it off (M2 Pro, GPU timer query around the main Pixi
stage), and the sprite layer about 3.3 ms of that. Improve measured frame cost and Direct3D compile
time across hardware without changing simulation speed, population or gameplay rules. The tick-frame
CPU cost of the sprite layer is [tick-frame-cost.md](tick-frame-cost.md), not this ticket.

## Scope

Measure first, then fix only what the numbers justify, interleaving the sides as `docs/DEVELOPMENT.md`
describes.

- **Direct3D compile time of the paged meshes** (`gpu/shading.ts`, `gpu/map-objects/decor-shadow-shader.ts`,
  `gpu/page-samplers.ts`). ANGLE over Direct3D 11 inlines every function, and `pageChain` inlines a
  mesh's whole shading once per page slot: `shaded-terrain` (bicubic 16 taps, 4 minify taps and the
  cover neighbourhood, 248 inlined texture operations) and `decor-shadow` (36 blur fetches, 304) now
  compile as long as the world batch program on the GitHub runner's WARP device, 7 to 9 s each at
  that runner's pace, where `npm run test:shaders -- --angle=d3d11` records them. The boot's warm-up
  links them off the main thread, so the cost is first-start time, not a freeze. Fewer page slots on
  Direct3D or one `sampler2DArray` for same-sized pages would cut the chain; measure with the
  Direct3D check before and after.
- **Paletted ship mesh size query** (`gpu/paletted-sprite/shader.ts`). The mesh re-reads `textureSize`
  on every tap, and the world batch's `textureSizeOf` walks the chain once per fragment; the page size
  could ride a vertex attribute.
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
- `npm run test:shaders -- --angle=d3d11` on Windows or through the CI workflow's `shaders` input,
  before and after.
- `npm run check`, `npm run build`, `npm test`.
