# Draw building damage with the authored fire and smoke points

**Area:** pipeline, render · **Focus:** effects · **Priority:** P2

Every `[GfxHouse]` record in the mod's `budynki12/houses/houses.ini` authors `GfxFirePoint` (5806
lines) and `GfxSmokePoint` (12304 lines), and the landscape records `fx fire house 0/1/2` and `fx smoke`
hold the loops. The pipeline extracts neither key. A damaged building draws procedural grey puffs on a
guessed roof wedge instead (`packages/render/src/data/effects/smoke.ts` names this approximation).

The same file also has 26 type-3 `GfxOverlay` lines (`<level> 3 <state> <x> <y>`, no bob list) on
houses, bakeries, potteries and smithies. Only type 4 is extracted (`extractBuildingOverlays`). Their
roof positions suggest chimney smoke, but that is a guess.

## Scope

- Investigate first how the point lines encode position, size level and damage stage, against the
  building art. Settle the type-3 overlay meaning the same way, or leave it out and say so in the
  extractor.
- Extract the points per building record and size level (bump `IR_VERSION`).
- Replace the procedural damage smoke with the authored fire and smoke loops at those points, scaled by
  the damage. Keep the existing damage gate from the snapshot readers.

## Verify

- Pipeline test over a synthetic `[GfxHouse]` record with fire and smoke points.
- Render test: a damaged building places effects at its authored points.
- Browser: `?scene=siege` shows fire and smoke on the damaged house at the roof points the art implies.
