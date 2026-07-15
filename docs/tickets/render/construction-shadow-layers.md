# Draw the construction stages' shadow bobs (shadowBobId)

**Area:** render (+ app content binding) · **Origin:** BMD build-progress reveal work, 2026-07-14 ·
**Priority:** P3

Every `constructionLayers` row in `content/ir.json` carries a `shadowBobId` beside its `bobId`
(extracted from the `[GfxHouse]` `GfxBobConstructionLayer` records), but the app reducer
(`packages/app/src/content/building-gfx/construction.ts`) drops it — construction sites cast no
shadow until the finished body draws. The referenced bobs are real: type-1 (1-bit mask) silhouettes
in the house `.bmd`s (e.g. `ls_houses_viking2.bmd` bob 223, a 535×210 ground shape). The original
draws a darkening shadow under construction. Whether that shadow is revealed progressively still
needs observation.

## Scope

- Thread `shadowBobId` through `constructionRefsByType` into the render construction stack as a
  darkening layer under the stage bob (the render side needs a shadow draw mode — check how/whether
  finished-building shadows are drawn first; if they aren't, consider one shared shadow seam).
- Reveal gating: the original's shadow blit is also time-gated; reusing the stage's reveal window is
  the natural fit. A 1-bit mask bob has no time bytes, so it appears whole (threshold 0) — decide
  and name the approximation.

## Verify

- `npm test` for the reducer join; `?scene=construction` for the shadow under a rising site —
  **user's eyes**.
