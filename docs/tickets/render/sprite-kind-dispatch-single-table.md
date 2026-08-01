# Route settler characters through the shared layer resolver

**Area:** render · **Focus:** data/sprites, gpu/sprite-pool · **Priority:** P3

`resolveCharacterLayers` (`gpu/sprite-pool/character-layers.ts`) resolves its frames by hand instead of
through the `sourceLayerFor` → `resolveFromLayer` pair that every other layered kind shares (both
private to `gpu/sprite-pool/layered-layers.ts`). It calls `lookupFrame` directly and hardcodes
`scale: 1` at both emit sites (body and head), so `kindScales.settler` is ignored exactly on the
real-content path (sheets with `characters`) while honoured on the synthetic fall-through. The human
branch also skips the shadow policy the animal branch above it applies, though `human-sheet.ts` loads
character atlases without a shadow twin, so that half is currently moot.

Two smaller seams in the same dispatch: `resolveSpriteFrame` (`data/sprites/resolve.ts`) has no
production caller, existing as a public barrel export used only as the bob-selection oracle by
`test/sprites/atlas.test.ts`, `settler-animation.test.ts` and `synthetic-atlas.test.ts`. And the
character branch passes `gaitClock` where the synthetic fall-through beside it drops it, an asymmetry
that reads like a bug in one `case` of `resolveLayers`.

## Scope

- Route the character body/head through `resolveFromLayer` (generalize it to carry atlas dimensions,
  which the paletted mesh path needs, and export it from `layered-layers.ts`) so scale has one owner.
  Decide there whether "settlers cast no shadow" is policy or an artifact of the atlases loaded.
- Decide `resolveSpriteFrame`: keep it as the tested pure seam, or delete it and retarget those
  assertions at `resolveSpriteBobId` + `lookupFrame`.
- Keep both kind dispatches exhaustive over `DrawKind`. The kind → binding-key rule still has two
  owners (`resolve.ts`'s grounddrop → `trunk` and `resolveDecorLayers`); a shared table is optional,
  agreement is not.
- Non-goal: changing any currently drawn frame. No sheet sets `kindScales.settler`
  (`content/sprite-sheet/human-sheet.ts` sets only `building`), so honouring it must not move pixels.

## Verify

`npm test`, `npm run check`, `npm run build`. Human seam: settlers, resources, buildings, signposts,
stockpiles in `?scene=sandbox` render unchanged.
