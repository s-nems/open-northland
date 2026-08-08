# Decide what needs mean on a buildingless seat inside a working economy

**Area:** sim · **Priority:** P2

`needsSystem` raises hunger on every person of a tribe that declares trades, and `planNeeds` answers it
only from a store on the eater's own player side or a wild berry bush (`settlers/targets/food.ts`). A
seat the map places with no buildings has neither, so its units pin at `ONE` and starve out.

The lobby's needs setting (`?needs=off`) answers the whole-map case: 24 decoded maps are authored with
no economy at all, and the player switches needs off for that match. It cannot answer the other 54
maps, which run an economy alongside seats that own nothing: switching the rule off there would also
free every seat that does have a larder.

Counted over `content/maps/`, on maps that do have buildings: **1146 civilization units** sit on seats
with none (plus 700 monsters, already exempt). On `gringo` those are 81 under `Posterunki Jego
Świętobliwości`, 24 under `Więźniowie`, 10 on the human seat, and 5 under `Habibi`. Seat 3 is the split
a player reads as a bug: its 81 saracens die beside 19 weresnakes the tribe rule already exempts.

## Scope

- Decide whether such a seat starves. The candidate exempting property is the absence of any reachable
  food source, not the tribe and not who controls the seat.
- Keep the rule a property of the world or the side. No id-specific branch per tribe or per map.

## Verify

- A headless scenario over a buildingless seat on a map that has an economy, asserting the chosen rule
  at tick 13000.
- `npm test`; `npm run test:content` for the decoded-map counts.
- Player-visible: `gringo` over a long match - the human's own ten-strong hero party on seat 0, and the
  mixed seat 3 where the saracens die and the weresnakes beside them do not.
