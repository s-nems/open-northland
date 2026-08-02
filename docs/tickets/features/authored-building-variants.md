# Draw authored buildings with their authored EditName bob variant

**Area:** app, render · **Priority:** P2

Authored placements collapse to `{typeId, tribe, x, y}`
(`packages/app/src/game/world/authored-placements.ts`) and every typeId draws its canonical bob
(`packages/app/src/content/building-gfx/families.ts`
`CANONICAL_EDIT_NAME = {1:'viking headquarters'}` → bob 34, crane roof). But the bridge map
authors `"viking headquarters house"` = bob 44 (longhouse) - so imported bases draw the wrong
building bodies. No entityId→BuildingBobRef override channel exists.

**Source basis (locally captured reference corpus):** HQ template match 0.966
→ bob 44 `ls_houses_viking4.house02`; name distribution across the 122 entity-bearing maps: 131
"viking headquarters house" vs 60 "viking headquarters" (6 maps author the plain name).

## Scope

- Carry the `buildingBobs` row (bmd/palette/bobId) alongside each `AuthoredPlacement`.
- After `runAuthoredMap`'s placement tick, build an `entityId→BuildingBobRef` override map
  (match sim building entities to placements by cell+typeId); thread it through the
  SpriteSheet-binding channel; the sprite pool consults it before the per-type binding.
- Only override with refs whose `BUILDING_FAMILIES` family is loaded (count + report the rest).
- No-entity/no-override path stays byte-identical; gfx never enters the sim.

## Verify

- Unit test the override construction (authored name wins; unloaded → canonical; demo unaffected).
- `?map=specjalna_mosty_na_rzece`: HQ draws bob 44; a plain-"viking headquarters" map still draws
  bob 34 - **user's eyes**.
