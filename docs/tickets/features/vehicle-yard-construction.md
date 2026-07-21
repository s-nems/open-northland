# Build vehicles physically on workshop yards

**Area:** sim + app + pipeline · **Priority:** P2

The extracted content lists the vehicle goods (`handcart`, `oxcart`, `ship_small`, `ship_big`,
`catapult`) as ordinary workshop wares: joinery levels 2–3 `produces` them and their `logicstock`
slots store them, so they appeared in the Produkcja rows and the Magazyn panel like a loaf of bread.
That is wrong. In the original a vehicle is not a stockpiled good; the workshop constructs it
**physically on a yard tile beside the building** (it appears standing on the map, like a construction),
and it then acts as a unit/transport, not a ware (user decision 2026-07-16).

## Current state (temporary block)

The pipeline strips vehicle goods from every building's `stock` and `produces` before the recipe join
(`stripVehicleGoods` in `tools/asset-pipeline/src/decoders/ini/types/buildings.ts`, called from
`tools/asset-pipeline/src/stages/ir/index.ts`). A vehicle good is identified by its id slug matching a
`[logicvehicletype]` id (the two tables share debugname slugs). So today no workshop crafts, stores,
or lists a vehicle; the `vehicles` IR table and the goods records themselves are untouched.

## Scope

Implement vehicle construction as its own mechanic and remove the temporary strip:

- A vehicle-producing workshop (joinery 2/3 per `produces`; check `logicvehicletype` semantics for the
  vehicle-kind buildings, `logicmaintype 6`) builds a vehicle on a free yard cell next to the building,
  consuming that vehicle good's `productionInputs`.
- The finished vehicle is a map entity (the `vehicles` IR table has capacity via `stockslots`), not a
  stockpile entry; probe the original for how completion looks/behaves before pinning mechanics.
- Remove `stripVehicleGoods` and regenerate `content/`.

Sandbox content already marks these goods `storable: false`. Source basis for the remaining details:
the readable `[logicvehicletype]`/vehicle-house fields and observation of a joinery producing a
handcart. Name any unobserved yard-cell or worker-animation rule as an approximation.

## Verify

Tests cover material consumption, deterministic free-yard selection, a blocked yard, and a finished
vehicle entity that never enters ordinary stock. Run `npm run test:pipeline`, `npm test`, `npm run
check`, and `npm run build`; compare one handcart build with the original.
