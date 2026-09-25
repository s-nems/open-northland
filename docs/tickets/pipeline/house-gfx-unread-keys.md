# Extract the remaining authored building graphics keys

**Area:** pipeline, sim, app, render · **Focus:** buildings-gfx · **Priority:** P3

Three `[GfxHouse]` keys in the mod's `budynki12/houses/houses.ini` never reach the IR:

- `arrowSlotData` (26 lines, on towers, headquarters, barracks, the cathedral and the pyramid). Garrison
  shots launch from the building anchor, not from the authored slots
  (`packages/sim/src/systems/settlers/atomics/effects/combat/hit/projectile-launch.ts`).
- `Gfxdoorbobid` (171 lines, e.g. bob 56 on the viking home, a 64×77 piece at the door). This is
  probably a door front drawn over a settler going in (unconfirmed).
- `gfxoverlaylandscape` (10 lines): the lighthouse beacon, the animated Semiramis gardens overlays
  (16 frames) and 7 colour overlays for the 8th wonder.

## Scope

- Investigate first what each key's values mean against the building art. Say in the extractor which
  meaning is confirmed and which is approximate.
- Extract all three and bump `IR_VERSION`.
- Launch garrison projectiles from the arrow slots, draw the door piece over the entering settler, and
  loop the landscape overlays on their buildings.
- The wonder colour overlays can wait for
  [wonder staged construction](../features/wonder-staged-construction.md) if they depend on its stages.

## Verify

- Pipeline tests for each key over synthetic records.
- Browser: tower arrows leave from the slots; a settler walking into a home passes behind the door
  piece; the lighthouse beacon animates.
