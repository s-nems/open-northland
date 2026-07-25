# Unify sprite kind dispatch and route characters through the layer resolver

**Area:** render (data/sprites, gpu/sprite-pool) · **Priority:** P3

Two independent kind-dispatch chains encode the same routing rules and are documented as
behaviourally divergent: `data/sprites/resolve.ts` (`resolveSpriteBobId`) and
`gpu/sprite-pool/resolve-layers.ts` (`resolveLayers`). In production `resolveLayers` handles every
kind first, so the only branch of `resolve.ts` still reachable is a settler on a sheet without
`characters`; `resolveSpriteFrame` has no production caller at all (tests and the barrel only). A
new draw kind must today be added to two chains that are allowed to disagree.

In the same file, `resolveCharacterLayers` bypasses the `sourceLayerFor` → `resolveFromLayer`
helpers it sits beside: it calls `lookupFrame` directly, hardcodes `scale: 1` at both emit sites,
and skips the shadow policy, so `kindScales.settler` is silently ignored exactly on the
real-content path (sheets with `characters`) while honoured on the synthetic fall-through.

## Scope

- One kind → resolver table shared by both entry points, or delete the unreachable `resolve.ts`
  branches plus `resolveSpriteFrame` and retarget their oracle tests at `resolveLayers`.
- Route the character body/head through `resolveFromLayer` (generalize it to take atlas
  dimensions if needed) so scale and shadow policy have one owner.
- Non-goal: changing any currently drawn frame; no sheet currently sets `kindScales.settler`
  (`content/sprite-sheet/human-sheet.ts` sets only `building`), so honouring it must not move
  pixels.

## Verify

`npm test` (retargeted resolver oracles), `npm run check`, `npm run build`. Human seam: settlers,
resources, buildings, signposts, stockpiles in `?scene=sandbox` render unchanged.
