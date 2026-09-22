# Let a computer seat turn on a neutral player camping in its villages

**Area:** sim · **Focus:** ai-player · **Priority:** P3

A neutral player's people can stand in a computer seat's settlement for the whole game without the
seat ever reacting. `aiDiplomacySystem` (`packages/sim/src/systems/ai-player/diplomacy.ts`) answers
only another player's stance: a neutral seat turns enemy toward a player that holds it as enemy, and a
friendly seat drops to the other's stance.

Original (a hypothesis, unconfirmed): on the look at a neutral slot that does
not hold the seat as enemy, the seat walks that player's humans (a filtered subset, flag 1) and
looks up the seat's village at each one's position. A human inside one of the seat's villages
raises a per-slot counter and ends the look; the seat turns enemy once the counter passes 5, so on the
sixth look in a row. A look that finds nobody inside resets the counter, and so does a mutual
friendship. The strategic AI also skips its whole turn, this look included, until
it has laid out the seat's villages.

This build's AI has no village areas, so the work starts with what a village covers and which
humans flag 1 selects.

## Scope

- The seat's village areas, read from the original's village layout or named as an approximation.
- The trespass counter as saved per-seat state, raised and reset as above.

## Verify

- System tests: a neutral player's settler standing in the seat's village for six looks turns the
  seat enemy; one look with nobody inside resets the count; an enemy or mutually friendly pair never
  counts.
