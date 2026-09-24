# Show the maps' butterflies

**Area:** app, render · **Focus:** wildlife presentation · **Priority:** P2

Maps author 2,112 butterflies (`setanimal` species `butterflies`, tribe 35) across 54 maps, and none
appear. Both halves drop them:

- Placement: `contentJoins` (`packages/app/src/game/world/content-joins.ts`) admits a species only when
  its `animaltypes.ini` record has `hitpoints_adult > 0`. The butterfly record has 0 (baby 500),
  `cannotbeattacked 1`, `catchable 0`, `maximumcadaversize 0`, `maximumgroupsize 2`, `movespeed 48`,
  so every authored butterfly is counted in `skippedAnimals`. `resolveAnimalTribes` in
  `packages/sim/src/harness/populate.ts` skips it the same way.
- Look: `animals/jobgraphics.ini` binds tribe 35 to `CR_Ani_Body_01.bmd` with palette `butterfly01`.
  The pipeline serves that atlas (66 bobs) and its shadow, but no `[bobseq]` names `CR_Ani_Body_01`,
  either in the mod's `animations.ini` or in `mapmoveableanimations/animations.cif`. So
  `loadAnimalCharacters` leaves the tribe unbound.

The data gives butterflies no gameplay role: they cannot be attacked, caught or butchered, and no map
script names the species. They are presentation, not sim entities. Spawning them in the sim would add
per-tick wandering work for no rule that reads it.

## Scope

- Investigate first: how the original picks frames from the 66 bobs with no sequence table (facing
  count, cycle length, the smaller bobs from 33 on). Record the source basis where the frame table
  is built.
- Draw each authored butterfly as a presentation-only creature near its authored half-cell: a short
  fluttering drift within a small radius (the record's `maximumdistancetobirthpoint 10` bounds it),
  animated from the investigated frame layout, with its cast shadow.
- Keep the sim's hitpoint gate. Butterflies must not enter sim state, hashes or saves.
- Hide them under fog the way wild animals are hidden: a butterfly shows only on a cell the viewer
  currently sees.
- The per-frame work scales with the butterflies on screen, not the map total.
- Stop listing butterflies as unbound in the `animal looks unbound` warning once they draw.

## Verify

- A unit test on the frame table and the drift, deterministic from placement and presentation clock.
- Headless: a golden hash on a map that places butterflies is unchanged.
- Browser: `wielka_kolonizacja` (102 butterflies) shows them at their authored spots, hidden under
  fog. Final look: human acceptance.
