# Keep a split click's side check from relabelling the map after every walk flip

**Area:** sim · **Priority:** P3

A move order onto ground a closed gate or wall splits (`clickSides`,
`packages/sim/src/systems/movement/structure-route.ts`) asks `structureSameRegion` whether the box's
sides join. `GroupReachability` answers a pair its two-sided search cannot settle in 4096 rounds from
one labelling pass over the whole map, and keeps the labels only per walk-block version: any
walkable-node flip anywhere on the map (a felled tree, a new site, an emptied deposit) bumps the
version and drops them.

Measured on a 512x512-node grass map with a full-width wall, `GroupReachability.sameRegion` for a
pair across the wall after a version bump: about 5 ms (the labelling pass), 0.02 ms when repeated
without a flip. In a running economy almost every such click pays the pass on the sim thread (the
worker's slot query, or in-tick for a direct `moveUnit` onto a blocker). An attack-move skips the
check.

## Scope

Make the labels survive flips that cannot change the answer: a freed node whose open neighbours all
carry one label joins it, a blocked node needs a proof that its region stays whole, and anything else
relabels. Keep results exact and deterministic.

## Verify

- The measurement above, repeated with a flip between clicks, drops to the repeat cost; name the
  scenario and numbers in the commit.
- Existing palisade route and formation slot tests stay green; goldens unchanged.
