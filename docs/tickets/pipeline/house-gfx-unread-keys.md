# Extract the remaining authored building graphics keys

**Area:** pipeline, sim, app, render · **Focus:** buildings-gfx · **Priority:** P3

Three `[GfxHouse]` keys in the mod's `budynki12/houses/houses.ini` never reach the IR:

- `arrowSlotData` (26 lines, on towers, headquarters, barracks, the cathedral and the pyramid). Garrison
  shots launch from the building anchor, not from the authored slots
  (`packages/sim/src/systems/settlers/atomics/effects/combat/hit/projectile-launch.ts`).
- `Gfxdoorbobid <level> 1 <bob>` (171 lines). The art shows an open door: bob 154 of the viking
  smithy in `ls_houses_viking2` is its door swung open. The smith's in-house programs (`gfxanimmode 2`,
  extracted as `houseBob` entries with `layer 4`) open it in the windows where he walks in or out;
  `packages/render/src/data/scene/in-house.ts` skips those entries. Layer 4 matches the door bob on
  the smithy only by its bob offset (base + 4); other buildings use other offsets, so how a layer
  names a bob is unconfirmed.
- `gfxoverlaylandscape` (10 lines): the lighthouse beacon, the animated Semiramis gardens overlays
  (16 frames) and 7 colour overlays for the 8th wonder.

## Scope

- Investigate first what each key's values mean against the building art. Say in the extractor which
  meaning is confirmed and which is approximate.
- Extract all three and bump `IR_VERSION`.
- Launch garrison projectiles from the arrow slots, open the door while a settler walks in or out, and
  loop the landscape overlays on their buildings. Stage the smith's `houseBob` door entries the same way.
- The wonder colour overlays can wait for
  [wonder staged construction](../features/wonder-staged-construction.md) if they depend on its stages.

## Verify

- Pipeline tests for each key over synthetic records.
- Browser: tower arrows leave from the slots; a settler walking into a home opens its door
  and the smithy door opens with the smith; the lighthouse beacon animates.
