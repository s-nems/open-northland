# Give saracen and egyptian homes their own build chain and cost

**Area:** pipeline, data, sim · **Priority:** P2
**Needs user:** the deciding evidence is the running original.

Footprints and hitpoints already resolve per `(tribe, typeId)` (`BuildingType.tribeVariants`). The
construction cost and the upgrade chain still collapse to the lowest `LogicTribeType`
(`extractConstructionCosts`, `extractUpgradeTargets` in
`tools/asset-pipeline/src/decoders/ini/buildings-gfx/structure.ts`), so every civilization builds homes
the viking way.

That is wrong for two civilizations in the mod's `DataCnmd/budynki12/houses/houses.ini`. Viking, frank
and byzantine homes are one `[GfxHouse]` record chaining `LogicType 0 2` to `4 6`, each level costing
only its step. Saracen (`saracen tent 01`, `saracen residence 02/04/05/06`) and egyptian
(`Egypt Residence 01/02/03/05/06`) homes describe each of the typeIds 2 to 6 in a record of its own,
with no chain, and `LogicConstructionGoods` holds the cumulative cost: typeId 6 costs
`4 5 5 2 4 3 3 26 24 24 25 25 27 27`, the whole viking chain summed. Those four typeIds (3 to 6) are the
only ones whose cost disagrees across tribes.

Today a saracen home is placed at level 0 and upgraded along the viking chain, paying the viking step
costs, and its footprint is widened over that chain so the growth has room.

## Investigate

In the running original, as saracens or egyptians: can a home be upgraded in place, and does the build
menu offer the higher residences as separate buildings at their full cost?

## Scope

- If each level is its own build: key the upgrade chain and the cost per tribe, drop the footprint's
  chain widening for tribes without a chain, and let the build menu and the AI's home entries offer the
  higher levels directly.
- If they upgrade like the others: keep the collapse, and record the observation next to
  `extractConstructionCosts` as the source basis for ignoring the cumulative cost.

## Verify

- Extraction tests over a synthetic fixture with one chained tribe and one unchained.
- `npm run test:pipeline`; a saracen seat builds and grows its homes on `?map=wielka_inwazja`.
