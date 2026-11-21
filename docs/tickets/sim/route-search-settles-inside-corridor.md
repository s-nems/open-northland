# Cut the nodes a route search settles inside its corridor

**Area:** sim · **Focus:** nav, movement · **Priority:** P3

A ghost walker's walk of 16 columns and more searches a corridor of cluster regions
(`nav/pathfinding/corridor-route.ts`), and any other land walk under the structures, a collider's
included, is handed to it once its map-wide search has settled 2048 nodes (512 for a collider's long
walk). What is left is the search inside the corridor: the land heuristic of
`nav/pathfinding/find-path.ts` weighs ground as grass (2), inflated by a quarter, while about 30% of
walkable ground weighs 3 or 4, so the search still settles ground behind the walker. Measured on two
late sessions (six computer seats on `magiczny_las` from tick 100000, eight on `diamentowa_dolina` from
tick 80000), 2200 ticks each, before the handover and the inflation:

- Searches of at most 2048 settles are 99% of the ghost walkers' searches and 65-71% of their settles,
  and the corridor leaves them about as they were: a walk of 32 nodes and more settles 4-5 nodes per
  node of its route.
- The longest corridor searches still settle most of their corridor: 15,313 nodes for a 513-node walk,
  8,000-9,500 for walks of 220-260 nodes. A chase handed over on `magiczny_las` from tick 60000 settles
  8,361 nodes where the map-wide search settled 21,913.

## Scope

One measured lever, which moves routes and needs the owner's sign-off on route cost. It was measured
before the land estimate was inflated by a quarter (`LAND_ESTIMATE_INFLATION`), so measure it again on top:

- Estimate a node's remaining cost through the region route instead of along the straight line: on to
  the mean node of a region two ahead, then that region's cost to the goal. On the searches over 1024
  settles it settles 10-20% of what the map-wide search does (the 90,711-settle walk takes 3,630), for
  routes 1-4% dearer on average, the 95th percentile 9-11% and the worst 15-25%, with region weights
  averaged over a region's cheapest quarter; with the mean weight it settles half of that again and routes
  cost 9-11% more on average. A candidate for the corridor searches that pass a settle cap only.

Landmark (ALT) lower bounds over the static lattice left the settles unchanged, and narrower corridors
(no margin, or 8-node clusters with one cluster of margin) cost 3-17% in route cost.

## Verify

- A replay of logged walks on both sessions: settles per route and route cost against the current search.
- `bench:map` on both checkpoints: pathfinding mean, p95 and max, and the largest settles in one tick.
- `npm test`, `npm run check`, `npm run build`.
