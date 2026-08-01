# Classify vehicle goods before building recipes are assembled

**Area:** pipeline · **Priority:** P3

`stripVehicleGoods` reparses affected building recipes to remove vehicle rows emitted by the goods
extractor. It identifies vehicles through slug collisions even though the vehicle table is available
when goods are extracted.

## Scope

- Classify vehicle rows in the goods extractor from the vehicle table.
- Stop vehicle rows from entering building recipes and remove `stripVehicleGoods`.
- Preserve the emitted IR exactly. Vehicle construction remains in
  [vehicle-yard-construction](../features/vehicle-yard-construction.md).

## Verify

- Synthetic tests pin a vehicle/good slug collision at the extractor boundary.
- Byte-compare `content/ir.json` before and after; run `npm run test:pipeline`, `npm test`,
  `npm run check`, and `npm run build`.
