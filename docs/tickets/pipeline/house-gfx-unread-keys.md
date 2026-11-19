# Use authored arrow slots and open the door for a craftsman at work

**Area:** pipeline, sim, app, render · **Focus:** buildings-gfx · **Priority:** P3

Two authored building details in `budynki12/houses/houses.ini` still lack runtime behavior:

- `arrowSlotData` (26 lines, on towers, headquarters, barracks, the cathedral and the pyramid). Garrison
  shots launch from the building anchor, not from the authored slots
  (`packages/sim/src/systems/settlers/atomics/effects/combat/hit/projectile-launch.ts`).
- The open door (`Gfxdoorbobid`) draws while a drawn settler of the building's player stands on or beside
  the door node (`packages/app/src/view/projections/open-doors.ts`). A craftsman performing an in-house
  program (`gfxanimmode 2`) counts as indoors there, so the door stays shut while he walks in and out of
  his workshop. The smith's programs also carry `houseBob` entries with `layer 4`, which
  `packages/render/src/data/scene/in-house.ts` skips; layer 4 matches the door bob on the smithy only by
  its bob offset (base + 4), and other buildings use other offsets, so how a layer names a bob is
  unconfirmed.

## Scope

- Investigate first what the arrow-slot values and the door-layer references mean against the building
  art. Say in the extractor which meaning is confirmed and which is approximate.
- Extract arrow slots and bump `IR_VERSION` when the IR shape changes.
- Launch garrison projectiles from the arrow slots.
- Open the door for a craftsman shown at his in-house program, in the windows where he walks in or out.

## Verify

- Pipeline tests for the arrow slots over synthetic records.
- Browser: tower arrows leave from the slots; the smithy door opens with the smith.
