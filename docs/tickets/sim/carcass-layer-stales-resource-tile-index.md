# Keep the resource tile index current when a carcass re-arms its next layer

**Area:** sim · **Focus:** economy/harvest · **Priority:** P2

`depleteNode` (`systems/settlers/atomics/effects/goods/harvest.ts`) turns a drained carcass layer into
the next one by writing `Resource.goodType` in place. It re-adds the `Resource` component, which journals
a membership change, only when the harvest atomic changes too. `resourceTileIndex`
(`systems/footprint/resource-tile-cache.ts`) keys each node on its tile and good and replays only
membership changes, so after a goods-only swap `resourceAtTile` still files the node under the old good.
A ground drop of the new good at the carcass is then not routed to the carcass's work cell
(`positionedInteractionCell`), while the old good still is.

Reproduced on `magiczny_las_12_players` with 13 AI seats from the 30k checkpoint of the recipe in
`docs/DEVELOPMENT.md` (Measuring performance): `world.verifyCaches()` first reports
`resourceTileIndex holds a stale tile→resource map` at tick 30087, when a carcass node goes from good
21 to good 9 in place.

## Scope

- Journal every in-place layer swap that changes what the tile index keys on, and leave the region
  index's harvest-atomic re-add rule covered by the same change.
- A headless test drains a carcass layer whose next layer has another good but the same harvest atomic,
  then checks `resourceAtTile` for both goods and `verifyCaches()`.

## Verify

- The new test; `npm test`.
- From the 30k checkpoint, 100 ticks with `verifyCaches()` after each report no `resourceTileIndex`
  mismatch. Golden hashes may move only where a hunt leaves a layered carcass.
