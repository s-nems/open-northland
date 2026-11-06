# Land a computer seat's big army on a tower-ringed home island

**Area:** sim · **Focus:** computer-player/military/operations/landing · **Priority:** P2

Owner ruling: a computer seat with a big army attacks, sails back and attacks again instead of hoarding.
On island maps its headquarters landings stop early. A landing sails only on a course whose water stays out
of reach of every tower and shelter the seat believes stands (the flood and dock routes in
`landing/landing.ts`). A rival home island ringed by known towers has no such course, so its land goes into
`ComputerNoWay` and is judged again every `NO_WAY_RECHECK_TICKS`, failing each time, to the end of the game.
Its colonies stay open to raids, and the big army stays at home.

Measured on arabskie_wyspy_wolna_gra_mieszana, five computer seats, no lobby peace, 150 minutes, seeds 7, 13
and 21:

- **Headquarters landings:** one per seed, none after minute 124.
- **No-way marks:** each attacking seat keeps one or two rival home islands marked from minutes 100 to 125
  until the end.
- **Idle armies:** seats in attack posture end with 213 to 280 idle fighters and 4 to 7 free ships. Raids on
  colonies go on every 5 to 6 minutes.
- **Tick cost:** each failing re-judgement costs one 75 to 118 ms tick. These are about half the ticks over
  60 ms after minute 90 (30 per three games, against 23 on main without the war).

## Scope

- When no course clear of known fire exists, a headquarters landing still sails if its wave outweighs the
  believed defence plus the fire of the towers and shelters along its course. The fire it passes counts as
  defence, the same way the storm weighs the towers covering its objective.
- A land kept in `ComputerNoWay` is not judged again while nothing the judgement reads has changed: the
  believed fire on its course, its shores and the seat's free ships. This takes the failing re-judgements
  off the late-game ticks.
- Keep the knowledge rule: the course reads only believed towers and shelters.
- Non-goal: raids, rescues and the landing fleet's size.

## Verify

- Run the same session headless and log each sea operation's kind, target, men, losses and end reason, plus
  the seat's `ComputerNoWay` entries every 5 minutes.
- Headquarters landings sail after minute 124 in at least two of the three seeds.
- Men lost per headquarters landing stay at most 40%.
- The late idle armies of seats with free ships shrink.
- Ticks over 60 ms after minute 90 are no more than main's count. Time them per system with
  `Simulation.setInstrument`.
- `npm test`, `npm run check`, `npm run build`.
