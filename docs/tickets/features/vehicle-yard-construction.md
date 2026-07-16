# Vehicles built physically on a yard (handcart, ox cart, ships, catapult)

## Problem

The extracted content lists the vehicle goods (`handcart`, `oxcart`, `ship_small`, `ship_big`,
`catapult`) as ordinary workshop wares: joinery levels 2–3 `produces` them and their `logicstock`
slots store them, so they appeared in the Produkcja rows and the Magazyn panel like a loaf of bread.
That is wrong — in the original a vehicle is not a stockpiled good: the workshop constructs it
**physically on a yard tile beside the building** (it appears standing on the map, like a construction),
and it then acts as a unit/transport, not a ware (user decision 2026-07-16).

## Current state (temporary block)

The pipeline strips vehicle goods from every building's `stock` and `produces` before the recipe join
(`stripVehicleGoods` in `tools/asset-pipeline/src/decoders/ini/types/buildings.ts`, called from
`tools/asset-pipeline/src/stages/ir/index.ts`). A vehicle good is identified by its id slug matching a
`[logicvehicletype]` id (the two tables share debugname slugs). So today no workshop crafts, stores,
or lists a vehicle; the `vehicles` IR table and the goods records themselves are untouched.

## Task

Implement vehicle construction as its own mechanic and remove the temporary strip:

- A vehicle-producing workshop (joinery 2/3 per `produces`; check `logicvehicletype` semantics for the
  vehicle-kind buildings, `logicmaintype 6`) builds a vehicle on a free yard cell next to the building,
  consuming that vehicle good's `productionInputs`.
- The finished vehicle is a map entity (the `vehicles` IR table has capacity via `stockslots`), not a
  stockpile entry; probe the original for how completion looks/behaves before pinning mechanics.
- Remove `stripVehicleGoods` and regenerate `content/`.

## Notes

- Sandbox catalog already marks these goods `storable: false` (`packages/app/src/catalog/goods.ts`),
  so the hand-authored sandbox stores never listed them; only the extracted content did.
- Source basis to gather before implementing: observed original behavior of the joinery producing a
  handcart (where it spawns, whether a worker assembles it on the yard), and the `.ini` fields on
  `[logicvehicletype]` / vehicle-kind houses.
