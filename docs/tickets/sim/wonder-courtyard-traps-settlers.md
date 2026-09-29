# Keep settlers out of the courtyards two wonders enclose

**Area:** sim · **Focus:** footprint, movement · **Priority:** P3

The walk bodies of `wonder_8th_wonder` (every tribe) and `wonder_gardens_of_semiramis` (every tribe,
even anchor row only) enclose multi-node courtyards: 7 nodes and 43 nodes that no path reaches from
outside the building. A settler standing there when the site is placed or finishes stays trapped:

- `settleFootprint` evicts only settlers on body cells, and the one-node nook rule in
  `packages/sim/src/systems/movement/evict.ts` covers single-node holes, not a courtyard;
- `nearestFreeCellOutside` in the same file accepts a courtyard node as a landing, since it only asks
  for one unblocked orthogonal neighbour, so a settler pushed off a wall cell can be dropped inside.

Verified with the real footprints at anchor (130,130): the 8th wonder's pocket includes (134,132) and
the semiramis courtyard includes (131,123).

## Scope

- A landing must lie outside every sealed pocket; `routeRegions(...).pocketed` already labels them.
- When a building's body goes up, also move the settlers and loose goods standing in the pockets it
  seals, the way body cells are evicted now.

## Verify

- A focused test in `packages/sim/test/movement/` with a settler inside each courtyard at completion:
  it ends up outside the body with a route to open ground.
- `npm test`.
