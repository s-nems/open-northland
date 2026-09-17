# Build vehicles as hidden construction sites beside the workshop

**Area:** sim, pipeline, app · **Focus:** `packages/sim/src/systems/settlers/drives/economy`, `systems/construction` · **Priority:** P2
**Blocked by:** [entity](vehicles-2-vehicle-entity.md), [content](vehicles-1-content-vehicle-types.md)

The pipeline strips vehicle goods from every recipe (`stripVehicleGoods`,
`tools/asset-pipeline/src/stages/ir/building-recipes.ts`) so no workshop can make one. The
original builds a vehicle as a house of type 42..46 next to the workshop and spawns the vehicle when
the site finishes ([VEHICLES.md](../../formats/VEHICLES.md#construction)).

## Scope

- When a workshop's current product is a vehicle good, the worker's drive: reuse an unfinished
  vehicle site within rings `r < 20` of the work centre, else pick a point within `r < 10` where
  every footprint node has clearance `>= logicSize`, house placement is allowed and no parked
  vehicle stands inside; ship sites go to a water continent bordering the worker's continent.
  Reasons 8 and 9 raise `vehicleSiteNotFound` / `vehicleSiteOccupied` and the worker idles.
- The site is an ordinary construction site of the paired house type: the worker fetches its
  construction goods and works with the build animation; the existing construction system does the
  rest. On completion the site is removed and `createVehicle` spawns the type at the site position
  for the workshop's owner and tribe.
- Remove `stripVehicleGoods`; classify vehicle goods in the goods extractor so they stay out of
  storage, `Produkcja` rows offer them as products, and the `Magazyn` panel never lists them.
- Chest row 91 (wooden and magical) spawns a catapult for the opener through `createVehicle`, replacing the empty-reward approximation in `systems/chests` and the chest table notes in MISSIONS.md.
- Mission goal `BuildVehicles`.

## Verify

Unit tests: site placement rings, blocked yard, ship site on water, material consumption through
the site, spawned vehicle never in stock, chest catapult. Acceptance scene: a joinery builds a
handcart. Pipeline, content, sim and app gates from `docs/TESTING.md`.
