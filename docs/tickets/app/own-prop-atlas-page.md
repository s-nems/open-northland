# Pack own props into shared texture pages so decor batches collapse

**Area:** app, render · **Focus:** own-assets · **Priority:** P3 · **Complexity:** medium

Every own prop is its own PNG, so its `TextureSource` is its own decor batch key
(`packages/render/src/gpu/map-objects/decor-batch.ts` groups a chunk's quads by source). Own-assets
mode now sends every walk-block-less prop (grass, flowers, mushrooms, bushes, ferns, reeds) down the
flat decor path, and on magiczny_las that is 73k placements over 32 chunks with ~70 distinct sources
per chunk: one mesh, one shader for a shaded batch, and one draw call each. Measured in headless
Chromium at the meadow review view (`?map=magiczny_las&assets=own&zoom=2&center=48,39`, 1280x800):
245 WebGL draw calls per frame against 84 for original assets at the same view. At `MIN_ZOOM` on a
1080p screen the viewport covers 12-16 chunks, so roughly 850-1100 draw calls. The JS side got
cheaper than before (the tall pooled-sprite path paid per visible grass sprite), but the batch count
breaks the render contract's "preserve batching" rule as soon as the camera zooms out.

## Scope

- Pack the delivered own prop PNGs into one or two shared pages at load (`packages/app/src/content/own-assets/props.ts`)
  or at publication (`tools/art-pipeline`), and point each prop's `SpriteLayer.source` and atlas
  frames at the page. Trees, rocks and the stump can join the same pages.
- Own props set `autoGenerateMipmaps`, so a page needs bleed margins around each frame or lower mips
  sample the neighbouring prop.
- Keep manifests, `editNames` joins and the `?art=gallery` preview unchanged.

## Verify

- Repeat the draw-call probe at the meadow view and at `MIN_ZOOM`: at most two decor batches per
  visible chunk (still and moving), draw calls back near the original-assets count.
- Human review at zoom 2 and zoom-out for seams, halos or wrong frames on grass, mushrooms and bushes.
- `npm test`, `npm run check`, `npm run build`.
