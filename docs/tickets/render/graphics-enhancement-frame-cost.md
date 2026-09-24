# Measure and bound the graphics enhancements at the x3 frame budget

**Area:** render · **Focus:** performance · **Priority:** P2

The world enhancements (original art filter, enhanced shadows, enhanced water, environment motion) ship
measured only for correctness. Every cost below is reasoned from tap counts, vertex sizes and Pixi's
batcher behaviour, never from a real GPU, and `packages/render/AGENTS.md` says headless Chromium cannot
answer it. The budget is 120 FPS at game speed x3.

Two of them are baseline costs: they are paid with every enhancement off, which the settings promise to
make free.

## Scope

Measure first, then fix only what the numbers justify. Interleave the sides and report process CPU time
plus GPU frame time, following the A/B rules in `docs/DEVELOPMENT.md`.

- **Sampler chain per texel tap** (`gpu/world-batcher.ts`, `gpu/pixel-art-magnify.ts`,
  `gpu/paletted-sprite/shader.ts`). `magnifyXbr` makes 12 tap calls plus 4 through `magnifySharp`, and
  `main` adds one size query; each expands the full `maxTextures` sampler if-chain, so a magnified
  fragment runs it 17 times rather than once. With the usual 16 batchable textures that is up to ~256
  branch comparisons per magnified fragment. ESSL 3.00 allows a `sampler2D` function parameter with a
  constant-indexed argument, so the chain can be entered once per fragment. The paletted path re-reads
  `textureSize` on all 16 taps as well.
- **Baseline vertex cost** (`gpu/world-batcher.ts`). `WORLD_VERTEX_SIZE` is 11 floats against Pixi's 6,
  so every world quad uploads 176 bytes instead of 96 and the packer writes 20 extra floats, two WeakSet
  lookups and a frame box per element per frame, with every enhancement off. `aFrame` is read only by
  the magnify and minify branches.
- **One page per soft bake** (`gpu/soft-shadow-cache.ts`). Each bake mints its own `CanvasSource`, so
  silhouettes that were sub-rect views of one `_s` page become one texture each inside the depth-sorted
  sprite layer. Past the batcher's texture slots a pass that was one page flushes repeatedly. Shelf-pack
  the bakes into one page per silhouette atlas if the draw-call count confirms it.
- **Program link on a live scaler change** (`gpu/world-batcher.ts`). Programs compile lazily inside the
  draw call, so the first frame after the player changes the filter links a new program mid-frame. Warm
  the four magnification programs when the enhancement settings change if the hitch is visible.
- **Per-frame churn with environment motion on** (`gpu/map-objects/map-object-layer.ts`). `motionTime`
  is `tick + alpha`, so the frame-identical early-out never fires and every visible swaying tall object
  rebinds each frame, including its shadow sprite. Screen-bounded and working as intended; confirm it is
  affordable on a forested map.
- **Flat decor shadow fill** (`gpu/map-objects/decor-shadow-shader.ts`). The blur is 36 texel fetches per
  fragment per frame. Only a handful of chunks are viewport-sized and most flat decor records carry no
  silhouette, so this is likely irrelevant; it needs a named decor-dense map to settle.

## Verify

- A numbered before/after on one real map at x3, each enhancement on and off, against the pre-branch
  renderer, with the interleaved A/B the perf docs require and the load average reported.
- Draw-call and batch-flush counts for a town view with enhanced shadows on and off.
- No visual change from any accepted fix: the default render stays byte-identical to the approved
  control capture, and the all-off render stays byte-identical to the same build with the enhancements
  removed from the draw path.
- `npm run check`, `npm run build`, `npm test`.
