# Remove the `as` casts in resolveSpriteBobId's per-kind dispatch

**Area:** render · **Origin:** /refactor-cleanup on packages/render, 2026-07-13 ·
**Blocked by:** [draw-item-discriminated-union](draw-item-discriminated-union.md) · **Priority:** P3

`data/sprites/resolve.ts` `resolveSpriteBobId` dispatches on `item.kind` and reaches
into `bindings[kind]`, but TS can't narrow `bindings[item.kind]` to the specific
union member after the `item.kind === …` guard, so four `as` casts paper over it:

```ts
if (item.kind === 'settler') return resolveSettlerBobId(binding as number | SettlerStateBinding, …);
if (item.kind === 'building') return resolveBuildingDraw(binding as number | BuildingTypeBinding, …).bob;
if (item.kind === 'resource') return resolveResourceDraw(binding as number | ResourceTypeBinding, …);
… return resolveStockpileDraw(binding as number | StockpileBinding, …).bob;
```

The casts are currently sound but bypass the kind↔binding correspondence — a
mis-paired kind/binding would compile. (The `grounddrop` branch already avoids the
cast by reading `bindings.trunk` directly.)

**Why deferred from the cleanup pass:** replacing the casts with a proven-narrowing
dispatch (a typed `kind → (binding, item, tick) => number | null` record, or a
`SpriteBindings` access restructured so the narrowing is inferred) is a small type
redesign that could subtly change lookup behavior if done wrong — worth its own
focused change with the resolver tests as the guard, not folded into the packaging
pass.

## Scope

Replace the four asserted narrowings with a dispatch TS can prove (a per-kind handler
table keyed by `SpriteKind`, or a discriminated `SpriteBindings` access). Keep every
resolved bob id identical. Pairs naturally with the `DrawItem` discriminated-union
ticket (a kind-tagged item makes the binding narrowing fall out for free) — do that
first if both are on the table.

## Verify

`npm run build`, `npm test` (sprites/building/settler-animation/settler-gait/
resource-stockpile suites), `npm run check`. Pure data decision — no golden move.
