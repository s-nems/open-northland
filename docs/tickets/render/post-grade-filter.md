# True colour-grade post pass (contrast/saturation filter over the world)

**Area:** render · **Origin:** visual-polish batch, 2026-07-16 · **Priority:** P3

The world post pass is currently a single multiply vignette sprite with a warm cast baked into its
gradient (`packages/render/src/gpu/post-fx.ts`). A real grade (contrast, saturation, lift) needs a
full-screen `Filter`/render-texture pass over `worldLayer` — blocked today because the team-colour
`PalettedSprite` meshes hand-roll their screen→clip projection and would render upside-down inside a
filter's render texture (the same bottom-up inversion `gpu/supersample.ts` documents; the portrait
inset already juggles it per render via `placePalettedFor(..., flipY)`).

Task: thread the `uFlip` state through the main render when a world filter is active (or move
PalettedSprite onto Pixi's projection uniforms), then replace/augment the vignette with a
`ColorMatrixFilter` (or custom grade shader) on `worldLayer`. Keep it one full-screen pass (no
per-sprite filters — packages/render/AGENTS.md), toggleable, and off under `?shot`.

## Verify

- Paletted settlers upright and correctly placed with the filter on (main view + portrait inset).
- `?shot` bytes unchanged; human A/B of the grade in `?map=` and a scene.
