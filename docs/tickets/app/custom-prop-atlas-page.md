# Pack custom props into shared texture pages so decor batches collapse

**Area:** app, render · **Focus:** custom-assets · **Priority:** P3 · **Complexity:** medium

Every custom prop is its own PNG, so its `TextureSource` is its own decor batch key
(`packages/render/src/gpu/map-objects/decor-batch.ts` groups a chunk's quads by source). Custom assets
mode sends every ground-cover prop (grass, mushrooms, rubble and the like) down the flat decor path, and
on magiczny_las that is tens of thousands of placements over 32 chunks with ~60 distinct sources per
chunk: one mesh, one shader for a shaded batch, and one draw call each. Measured in headless Chromium
on `?map=magiczny_las&assets=custom&center=48,39` at 1920x1080, WebGL draw calls per frame: 297 at zoom 2
and 445 at `MIN_ZOOM`, against 128 and 317 when the same props were tall pooled sprites, whose batcher
spans up to 16 textures (original-asset mode draws 469 and 776 at the same views). The batch count
breaks the render contract's "preserve batching" rule as soon as the camera zooms out.

## Scope

- Pack the delivered custom prop PNGs into one or two shared pages at load (`packages/app/src/custom/content/props.ts`)
  or at publication (`tools/art-pipeline`), and point each prop's `SpriteLayer.source` and atlas
  frames at the page. Trees, rocks and the stump can join the same pages.
- Custom props set `autoGenerateMipmaps`, so a page needs bleed margins around each frame or lower mips
  sample the neighbouring prop.
- Keep manifests, `editNames` joins and the `?art=gallery` preview unchanged.

## Verify

- Repeat the draw-call probe at the meadow view and at `MIN_ZOOM`: at most two decor batches per
  visible chunk (still and moving), draw calls back near the pooled-sprite count.
- Human review at zoom 2 and zoom-out for seams, halos or wrong frames on grass, mushrooms and flowers.
- `npm test`, `npm run check`, `npm run build`.
