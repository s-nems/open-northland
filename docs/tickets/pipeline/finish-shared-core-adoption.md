# Finish shared-core adoption in the asset pipeline

**Area:** pipeline · **Priority:** P3

Three cases where a shared core exists but later stages were pasted beside it instead of adopting
it. One bounded dedup session; no output may change.

**Palette LUTs.** `stages/palette-lut.ts` owns `buildPaletteLut` + `writeLutPng`, but only two of
four producers use them fully: `stages/goods/index.ts` re-implements the resolve → warn →
`identityPalette` → collect loop (its rows resolve by alias name, which the fixed
`PaletteLutSource[]` input cannot express), and `stages/player-colors.ts` inlines `writeLutPng`'s
body and duplicates its own per-player palette resolve block verbatim in two places. Fix: give
`buildPaletteLut` a resolver callback parameter; extract one per-player palette resolve helper.

**`[GfxHouse]` extractors.** `decoders/ini/buildings-gfx/structure.ts` owns the
`collectGfxHouseWinner` skeleton (walk → `logicTypeByLevel` → `existingGfxHouseWins` → collapse),
used by construction costs and hitpoints, while `extractUpgradeTargets` and
`extractBuildingFootprints` re-type the identical preamble and collapse. Fix: widen the skeleton
to take an `emit(rec, ctx)` callback so all four extractors supply only their per-record yield.

**Vehicle goods.** `stages/ir/building-recipes.ts` `stripVehicleGoods` is a self-declared
temporary corrective pass that re-parses every affected `BuildingType` to delete rows the
`[goodtype]` extractor emitted, identifying vehicles by slug collision. Fix: classify the good at
extraction (the vehicle table is available to `extractGoods`) and delete the corrective stage.
Related feature context: [vehicle-yard-construction](../features/vehicle-yard-construction.md).

## Scope

The three refactors above, each output-preserving. Non-goal: any change to emitted IR, LUT
bytes, atlases, or manifests.

## Verify

`npm run check`, `npm run build`, `npm test`, and `npm run test:pipeline` against the owned copy.
Byte-compare `content/ir.json` and the emitted LUT/atlas outputs before and after; identical
output is the completion proof.
