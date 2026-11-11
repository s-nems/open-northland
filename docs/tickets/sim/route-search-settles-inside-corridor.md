# Cut the nodes a route search settles inside its corridor

**Area:** sim · **Focus:** nav, movement · **Priority:** P3

A ghost walker's walk of 16 columns and more searches a corridor of cluster regions
(`nav/pathfinding/corridor-route.ts`), which bounds the search by the corridor instead of by the detour.
What is left is the search inside the corridor and the walks the corridor does not take: the land heuristic of `nav/pathfinding/find-path.ts`
weighs ground as grass (2) while about 30% of walkable ground weighs 3 or 4, so the search settles the
ground behind the walker too. Measured on two late sessions (six computer seats on `magiczny_las` from
tick 100000, eight on `diamentowa_dolina` from tick 80000), 2200 ticks each:

- Searches of at most 2048 settles are 99% of the ghost walkers' searches and 65-71% of their settles,
  and the corridor leaves them about as they were: a walk of 32 nodes and more settles 4-5 nodes per
  node of its route.
- The longest corridor searches still settle most of their corridor: 15,313 nodes for a 513-node walk,
  8,000-9,500 for walks of 220-260 nodes.
- A walk under 16 columns that detours round a wall or water floods as before, up to 31,355 settles for
  a 227-node route on the first session.
- A goal walled into a pocket of more than 512 nodes costs 5,161 settles to refuse: 118 refusals hold
  609,000 of the 1,350,000 settles of 2200 ticks from tick 40000 of the first session.

## Scope

- Hand a shorter walk to the corridor once the map-wide search has settled 2048 nodes without an answer:
  the corridor then returned the same route on all 60 such walks of the two sessions, at 5,837 settles for
  the 31,355 one. An unreachable goal then pays those settles twice unless the next item lands first.
- Refuse a walk whose endpoints no chain of cluster regions joins without the map-wide search. The
  regions are the mask's exact connectivity, and the corridor already hands such a walk back after a
  goal-side probe of 64 regions.

Two more measured levers, both of which move routes and need the owner's sign-off on route cost:

- Weigh the land heuristic heavier. Over 23,813 searches of the first session, 1.25 times heavier settles
  39% fewer nodes (47% fewer on routes of 64 nodes and more) for routes 1.1% dearer on average, the worst
  1.46 times; heavier only past 16 columns from the goal settles 16% fewer (29% and 47% on routes of 64
  and 128 nodes and more) for 0.4% dearer routes, the worst 1.23 times.
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
