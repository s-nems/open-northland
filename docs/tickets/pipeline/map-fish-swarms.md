# Import authored map fish swarms

**Area:** pipeline, data, app, sim · **Priority:** P3

The map stage drops the authored `lafm` fish-swarm lane: a fixed table of position, fish count, and
continent id. Maps with authored fishing grounds therefore load without those resources even though the
sim already has consumers for fish stocks.

## Scope

- Confirm the `lafm` byte layout against the owned corpus and decode the populated entries.
- Carry position, count, and continent identity through the map schema and authored-placement setup.
- Skip unused table slots without materializing placeholder entities; keep placement order deterministic.
- Leave unrelated `lmlp`, `emmi`, and `emvc` lanes outside this ticket.

## Verify

Synthetic chunk fixtures cover empty and populated slots, followed by a real-content join test proving
an authored swarm reaches the sim with its count and position. Run `npm run test:pipeline`,
`npm run test:content` when local content exists, `npm test`, `npm run check`, and `npm run build`.
