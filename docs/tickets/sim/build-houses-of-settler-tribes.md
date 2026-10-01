# Let a seat build the houses of every tribe it fields

**Area:** sim, app · **Priority:** P2

A seat places houses of its roster tribe only. `setupPlacementTribes` declares one tribe per seat
(`playerTribe` from the map roster), the command authority refuses a `placeBuilding` of any other
tribe, and the build menu lists that tribe's houses alone. Maps that hand a seat settlers of other
tribes leave them nothing of their own to raise: `nowa_nadzieja` gives the Viking seat one settler of
each tribe, `gringo_sub` gives the Frank seat Byzantine and Saracen settlers, and
`mroczny_swiat_sub3` mixes four tribes in the Viking seat.

Original behavior (read from the original's logic, unconfirmed against the running game): the build
menu walks every tribe's houses and lists one when the seat has it both
allowed and enabled for that `(seat, tribe)` pair. A house is enabled through the jobs that seat's
settlers of that tribe reach, so a Frank settler of a Viking seat who earns the right trades opens
Frank houses to that seat. Houses, homes and workplaces then take settlers of any tribe on their
side; only the trade itself is gated by the settler's own tribe.

## Scope

- Declare a seat's placement tribes from the tribes it fields (its settlers' tribes, kept current as
  settlers join or die), not from the roster alone. Keep the lobby nation choice as the seat's first
  tribe.
- Gate each tribe's houses by `buildingEnabled(owner, tribe, type)`, which already reads the
  `(owner, tribe)` unlocks.
- Show the other tribes' enabled houses in the build menu; the placed building keeps the chosen
  tribe's look, footprint and bill.
- Gate a workplace's recipes by its workers' tribes, not the building's. The original enables a
  product per `(seat, worker tribe)`; the recipe gates in `economy/production/` and the workshop drive
  read `Building.tribe` today, so a Viking crew in a Frank workshop of a human seat makes nothing the
  seat has not discovered for Frank settlers.

## Verify

Sim tests for the authority and the enabled set across two tribes in one seat. Browser pass on
`nowa_nadzieja`: after the Frank settler reaches a Frank trade, a Frank house appears in the build
menu, places, and its builders raise it.
