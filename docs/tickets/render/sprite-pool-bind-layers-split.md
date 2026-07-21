# Separate sprite reconciliation from per-entity layer binding

**Area:** render · **Priority:** P3

`gpu/sprite-pool/sprite-pool.ts` is about 527 lines. It owns both pool membership/lifecycle and the
operation that mutates one entity's body, shadow, reveal, and texture layers. The existing folder
already separates pure motion, picking, reconciliation, placeholder logic, and — since the box-arithmetic
pass — the feet-local layer geometry and bounds union (`layer-box.ts`). `bindLayers` is down to about
120 lines and is now the remaining mixed responsibility: texture/mesh binding proper.

## Scope

Extract the remaining binding behind a non-allocating context containing the sheet, texture cache, and
frame id. The two sprite-class branches (`PalettedSprite` mesh vs plain `Sprite`) are the natural seam —
they share only the resolved layer and the scratch box. Keep `SpritePool` responsible for membership,
attach/detach, reap, and orchestration. Preserve the public barrel and do not combine this move with
frame-selection changes.

While there: `PooledEntity.sprites` is typed `(Sprite | PalettedSprite)[]` with homogeneity guaranteed
only by the `paletted` flag, so both branches cast (`sprite-pool.ts`, the `as PalettedSprite` /
`as Sprite` reads). A binding context parameterised by sprite class would let the cast go.

## Verify

Sprite-pool, motion, reconciliation, and scene tests remain behavior-identical. Run `npm test`,
`npm run check`, and `npm run build`; visually compare a scene with construction, shadows, and team
colours.
