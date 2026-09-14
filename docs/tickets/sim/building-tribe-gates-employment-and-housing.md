# Decide what a building's tribe is allowed to gate

**Area:** sim, data · **Priority:** P2

`Building.tribe` must equal `Settler.tribe` before a settler may be posted, housed, or delivered to.
The question this ticket settles is whether that is the right rule, because the field now means two
different things depending on where the building came from:

- an authored building takes the `[GfxHouse]` record's `LogicTribeType`, joined in
  `tools/asset-pipeline/src/decoders/ini/buildings-gfx/shared.ts`;
- a player-placed one takes the seat's roster tribe (`MapPlayerSlot.tribeId`), threaded as
  `GameViewDeps.seatTribeOf`.

Evidence for keeping the gate: the key is `LogicTribeType`, sitting beside `LogicType`,
`LogicMaximumSize` and `LogicConstructionGoods` in the same record, while that record's graphics keys
are all `Gfx*`. The prefix is the source's own claim that the tribe is logic, not art.

Evidence against: shipping maps build one settlement out of mixed-tribe buildings and staff it across
that line. `CnModMaps/Burza Piaskowa` attaches saracen archers to an `Egypt Tower`, and the
third-party `Tale_of_Six_Sons_MULTIPLAYER` (outside the CnMod corpus) gives player 6 a `frank barn`, a
`viking home`, a `frank patricianhouse 02` and a `viking smithy` in one town, then attaches frank
humans to the viking buildings. Whether the original honours those attachments or drops them as we
do is unverified - that the maps load proves nothing either way, and it is the fact this ticket most
needs.

Measured cost today: 11 of the 188 authored `attachtohouse` rows are refused on this check alone, 8
tower garrison posts and 3 civilians, concentrated in the mixed-tribe maps.

## Scope

- Establish what the original does with a cross-tribe attachment before changing anything. Without
  that, both answers are guesses.
- The decision governs the player and AI paths, not only the authored import, which is why it did not
  ride along with `attachtohouse`. The consumers are workplace matching, job openings, delivery rules,
  the farming drive, construction employment, and the house pick highlight.
- If the gate stays, record it as an approximation with the mixed-tribe maps as the counter-evidence.

## Verify

`npm test`, then `npm run test:content` re-counting the authored attachments that land. One browser
pass on `burza_piaskowa` player 2, whose saracen archers stand in an Egyptian tower.

Related: `docs/tickets/app/tribe-partition-is-invisible.md` covers showing the partition to the player
and presumes this rule is real. The graphics join now reads the field: every civilization draws its own
buildings and settlers, so a refused cross-tribe attachment is visible on the map rather than silent.
