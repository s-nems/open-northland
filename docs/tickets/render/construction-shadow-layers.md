# Draw the construction stages' shadow bobs (shadowBobId)

**Area:** render (+ app content binding) · **Origin:** BMD build-progress reveal work, 2026-07-14 ·
**Priority:** P3

Every `constructionLayers` row in `content/ir.json` carries a `shadowBobId` beside its `bobId`
(extracted from the `[GfxHouse]` `GfxBobConstructionLayer` records), but the app reducer
(`packages/app/src/content/building-gfx/construction.ts`) drops it — construction sites cast no
shadow until the finished body draws. The referenced bobs are real, but they are **type-1 (8-bit
paletted) ground-shape images in the BODY `.bmd`**, not 1-bit masks (decoded from the owned copy:
`ls_houses_viking.bmd` bob 134 type=1 81×44; `ls_houses_viking2.bmd` bob 223 type=1 535×210; the
`_s.bmd` shadow libs are the type-2 1-bit sets and hold silhouettes only at the finished `GfxBobId`
ids, not at these layer ids). Observation of the running original shows a darkening shadow under
construction. Whether an 8-bit layer is used directly and whether it reveals progressively still need
observation.

## Scope

- Thread `shadowBobId` through `constructionRefsByType` into the render construction stack as a
  darkening layer under the stage bob. Finished-building/tree shadows now draw from the `_s.bmd`
  shadow-twin atlases (`SpriteLayer.shadow` + `shadowLayerFor` in
  `packages/render/src/gpu/sprite-pool/resolve-layers.ts`); the construction lane differs — its
  shadow bobs live in the body atlas as 8-bit images, so it needs either a darkening render of the
  body-atlas frame (alpha-only quad) or a pipeline bake of those bobs into the family's shadow sheet.
- Reveal gating: the original's shadow blit is also time-gated; reusing the stage's reveal window is
  the natural fit. The layer shadow bobs carry no time bytes, so they appear whole (threshold 0) —
  decide and name the approximation.

## Verify

- `npm test` for the reducer join; `?scene=construction` for the shadow under a rising site —
  **user's eyes**.
