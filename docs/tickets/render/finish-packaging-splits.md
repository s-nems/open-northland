# Finish the render packaging splits (effects, terrain, hud)

**Area:** render · **Origin:** /refactor-cleanup on packages/render, 2026-07-12

The render cleanup pass split the two clearly-overgrown LOGIC modules
(`data/scene/snapshot-readers.ts` 487→subfolder, `data/scene/sprite-scene.ts`
481→extracted `projectile-arc.ts`), and the types-only `data/sprites/bindings.ts`
has since been split into `settler-bindings.ts` + `layered-bindings.ts` (bindings.ts
is now a 50-line barrel). Three more files were diagnosed as mixing concerns but
deferred, all under the ~300-line threshold (so size does not justify the churn on
its own). They are real concern seams worth a dedicated packaging pass, done as
verbatim moves with an `index.ts` barrel keeping each import path stable.

## Scope

Split each by DOMAIN concern into a subfolder + barrel (bodies move verbatim; any
rename rides its own hunk):

- `data/effects.ts` (209) → `effects/{marks,blood}.ts` — combat-mark lifecycle
  (`CombatEffect`, lifetimes, `effectAlpha`, `effectKey`, `foldCombatEffects`) vs.
  procedural blood ballistics (`BLOOD_*`, `bloodDroplet`, `frac`). Importer: `gpu/overlays/effects-layer.ts` + test.
- `data/terrain.ts` (209) → `terrain/{tessellation,transitions,uv}.ts` — node geometry
  vs. transition-lane decode vs. UV folding. Importers: `gpu/shading.ts`,
  `gpu/terrain/terrain-layer.ts`, `gpu/pixi-app.ts`, `src/index.ts`.
- `data/hud.ts` (297) → `hud/{model,layout,place}.ts` — aggregation (`buildHud`) vs.
  layout (`layoutHud`) vs. placement (`placeHud`). Importers: `gpu/overlays/hud-layer.ts`,
  `src/index.ts` + test. (Consider pairing with the HUD generation-memo ticket.)

Each is independent; a single session can do all three.

## Verify

`npm run build`, `npm test`, `npm run check`, `npm run scan:structure`. No golden
should move (pure moves). Import specifiers change from `<file>.js` to
`<file>/index.js` — grep to confirm none were missed.
