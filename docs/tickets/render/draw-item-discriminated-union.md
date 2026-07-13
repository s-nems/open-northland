# Model DrawItem as a kind-discriminated union

**Area:** render · **Origin:** /refactor-cleanup on packages/render, 2026-07-13 · **Priority:** P3

`data/scene/draw-item.ts` `DrawItem` is one flat struct of ~20 independent optional
fields, but `kind` actually determines which are valid:

- `settler` → `facing`/`carrying`/`carryGood`/`jobType`/`weaponGood`/`engaged`/`young`/`atomicId`/`elapsed`
- `building` → `typeId`/`builtPct`/`working`
- `resource`/`stump`/`berrybush` → `goodType`/`level`/`levels`/`gfxIndex`
- `projectile` → `rotation`
- `stockpile`/`grounddrop` → `goodType`/`fill`/`isFlag`

Root `AGENTS.md` prefers "discriminated unions with exhaustive `switch` (a `never`
check) … rather than boolean flags". A `DrawItem = SettlerItem | BuildingItem |
ResourceItem | ProjectileItem | StockpileItem | TileItem` union would make the
per-kind assignment in `collectSpriteScene` (now `assignSettlerFields` /
`assignProjectileArc` / the inline building/resource/stockpile blocks) exhaustively
checked, and stop cross-kind field misreads at compile time.

**Why deferred from the cleanup pass:** this is a WIDE, pervasive change, not a
behavior-preserving move. `MutableDrawItem` is built incrementally field-by-field
(the assign-not-spread pattern in `collectSpriteScene`), which fights a discriminated
union; `sprite-pool.ts` reads `item.lift`/`item.isFlag`/`item.kind` kind-agnostically;
the fog-ghost path builds items generically. Doing it right needs a companion redesign
of the incremental-assign builder (e.g. a per-kind builder or a kind-tagged partial),
so it belongs in its own session.

## Scope

Introduce the per-kind union and an exhaustive consumer switch. Redesign the
`collectSpriteScene` incremental build so each kind's item is assembled as its own
member (not mutated onto a shared grab-bag). Update `sprite-pool.ts`, `resolve-layers.ts`,
`data/sprites/resolve.ts`, and the fog-ghost projection to the union. Keep the emitted
draw list and its ordering byte-identical (the scene tests pin it).

## Verify

`npm run build`, `npm test` (scene/sprites/collect/gathering/world-renderer suites),
`npm run check`. No golden/behavior change — a moved scene assertion means the union
altered a field's presence, which must be reconciled, not accepted.
