# Contested ground: reason hint and acceptance scene

**Area:** app · **Priority:** P3

`placeBuilding` refuses a site within `CONTESTED_GROUND_RADIUS_NODES` of a hostile fighter the seat can
see (`packages/sim/src/systems/conflict/contested-ground.ts`). The build-mode wash dims the disc and the
ghost hides, but the refusal gives the same signal as a tree or fogged ground: a vanished ghost and a
swallowed click. A house refused over clear grass eight cells from a soldier the player has not noticed
is not self-explaining.

## Scope

- Extend the seat placement probe with a refusal reason (`'footprint' | 'contested'`), the two halves
  `seatPlacementProbe` already computes separately, and show a localized held-item banner line while the
  hovered tile is refused for the contested reason.
- Register a `contested-ground` scene: a hostile band camped beside the player's town, headless checks on
  the probe inside and outside the disc, and the human pass below.

## Verify

- Headless: the scene's predicates pass; the banner model reports the contested reason at a node inside
  the disc and none outside.
- Browser: pick a house while an enemy band stands near the town. The wash dims a diamond around each
  enemy soldier and hero, not around civilians or a tower archer at his post; the ghost vanishes inside
  and returns outside; the banner names the reason; the diamond slides with a walking soldier without
  the rest of the wash flickering.
