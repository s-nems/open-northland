# Model PooledEntity as a paletted-discriminated union to drop the sprite `as` casts

**Area:** render · **Origin:** /refactor-cleanup on packages/render, 2026-07-14 · **Priority:** P3

`gpu/sprite-pool/pooled-entity.ts` `PooledEntity` pairs `readonly sprites: (Sprite | PalettedSprite)[]`
with `readonly paletted: boolean`, and documents the invariant "homogeneous per entity" (a paletted
settler draws only `PalettedSprite` meshes; every other entity draws only plain `Sprite`s, decided
once at creation by `SpritePool.isPaletted`). The invariant is enforced only by hand, so every access
re-casts on the `paletted` flag:

- `gpu/sprite-pool/sprite-pool.ts:~199` `const spr = s as PalettedSprite;` (in `placePalettedFor`,
  after an `if (!pe.paletted …) continue;` guard).
- `gpu/sprite-pool/sprite-pool.ts:~353` `pe.sprites[i] as PalettedSprite | undefined` (bindLayers,
  paletted branch).
- `gpu/sprite-pool/sprite-pool.ts:~373` `pe.sprites[i] as Sprite | undefined` (bindLayers, else).

The tell that the invariant is implicit: `gpu/sprite-pool/pick.ts` asks the same "is this a plain
Sprite?" question with a runtime `instanceof` instead. A future edit that appends the wrong sprite
class to a pooled entity compiles clean and mis-renders (or throws at `spr.place(...)`).

## Scope

Make `PooledEntity` a discriminated union so the element type is tied to `paletted`:

```ts
type PooledEntity =
  | (PooledEntityBase & { readonly paletted: true;  readonly sprites: PalettedSprite[] })
  | (PooledEntityBase & { readonly paletted: false; readonly sprites: Sprite[] });
```

Both members share the same property set (only the array element type differs, erased at runtime), so
the "stable monomorphic shape" intent in `pooled-entity.ts` is preserved — no V8 shape regression.

- `createPooled(kind, paletted)` builds the matching member from its runtime `paletted` arg.
- `placePalettedFor`'s cast (`:199`) drops cleanly: after `if (!pe.paletted) continue;`, `pe.sprites`
  narrows to `PalettedSprite[]`.
- `bindLayers`'s paletted-branch cast (`:353`) drops cleanly: the `if (pe.paletted && …)` short-circuit
  narrows `pe.sprites` to `PalettedSprite[]`.
- The `else`-branch cast (`:373`) is the subtle one: TS can't narrow `pe.paletted` to `false` from a
  *compound* condition. Restructure to `if (pe.paletted) { … } else { … }` and thread the
  `pe.paletted ⟹ this.sheet.palette !== undefined` invariant (guaranteed by `isPaletted`) so the LUT
  read inside the paletted branch stays sound without a cast.

This is a per-frame hot-path type change (medium risk, non-mechanical) — hence its own ticket rather
than riding the behavior-preserving cleanup pass.

## Verify

`npm run build` (declaration emit + strict), `npm test` (sprite-pool, reconcile, motion,
world-renderer, scene suites), `npm run check`. Behaviour-preserving — no golden should move. Confirm
zero `as PalettedSprite` / `as Sprite` casts remain in `sprite-pool.ts` (the `instanceof` in `pick.ts`
can stay or convert to the narrowed type).
