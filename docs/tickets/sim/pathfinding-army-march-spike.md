# Cut the path search an AI army march costs in one tick

**Area:** sim · **Focus:** movement/routing · **Priority:** P2

Every `pathfinding` spike in the twelve-player late game is one AI wave setting off. On
`magiczny_las_12_players` with 13 AI seats (700-1050 settlers, 210-238 buildings), the trust-clean
`npm run bench:profile` from the 40k checkpoint shows `pathfinding` at a 0.37 ms median but a 33.9 ms
max, ticks 43730-43731 at 31.8 and 33.9 ms in `drainPathRequests` (profiled timings are inflated by
the sampler); after the planner it is the largest spike source. The busy-machine profiles from 50k and
60k show the same shape at 24-44 ms. Replaying the spiking ticks with the searches counted (ticks
43730-43731, 50593, 51510-51512, 51724, 61498-61499, 61922-61923) gives the same picture every time;
the settled-node counts are exact and deterministic, the ms come from an instrumented replay on a busy
machine and are suspect:

- 5-13 requests per tick, all but one or two from soldiers (jobs 33-35) of one seat holding a
  `PlayerOrder`: the `attackMoveUnit` commands `ai-player/military/muster.ts` issues per soldier. Each
  one runs its own collider A* over the same 140-210 node corridor to neighbouring goals.
- A typical member settles 2,300-4,200 nodes at about 1.4 µs each (1.2 µs for a non-collider), so one
  tick settles 15-25k nodes: 24-40 ms.
- `PATHFINDING_NODE_BUDGET_PER_TICK = 16384` (`systems/movement/routing.ts`) is checked before each
  request, so a busy tick only stops once it has passed about 16k settled nodes, the last request
  admitted can overshoot the budget by its whole cost, and a march past the budget spills its remaining
  members into the next tick.
- One member in most spikes routes past `FLOOD_GUARD_MAX_EXPLORED = 4096`
  (`nav/pathfinding/find-path.ts`), so `findPath` runs probe 128 + aborted forward 4096 + goal-side
  exhaust (1.7k-8.3k, ending in `path`, which proves nothing) + a full forward search from scratch
  (4.3k-5.6k). That one request settles 10-17.5k nodes, of which 55-70% is thrown away. The same
  happens to a civilian: a 98-step route of a woman on a child order settled 12,965 nodes at tick
  60755.
- A collider's overlay (`blockedFor` in `drainPathRequests`) is a `LayeredBlocks` of the dynamic
  overlay (three per-node count arrays), the field posts and one set per other player's town, so with
  13 seats every neighbour test still walks up to 13 `Set.has` calls (`TerrainEdges.passable`,
  `nav/terrain/edges.ts`).

Expected gain: spike only, the `pathfinding` max of 34 ms at 40k and the p99 ticks it tops.

## Scope

Rule: an army order is an RTS command. Every member starts moving in the tick the order applies; a
march that peels off gradually is unwanted, even where the original let soldiers leave one by one. So
the cut comes from cheaper searches, never from fewer searches per tick: do not ration a march's path
requests across ticks, lower the budget, or stop the drain on an expected cost. Keep
`PATHFINDING_NODE_BUDGET_PER_TICK` as it is; the work below must bring a march under it so no member
spills.

Pure optimisations first, each keeping every returned path byte-identical:

- Stop the guard from discarding work on a legitimately long open route: scale the guard with the
  start-to-goal heuristic (or skip the guard when the probe already left a small pocket), so a
  corridor route runs one forward search. The guard only ever aborts a search with no verdict, so the
  answer cannot change.
- Compose a collider's overlay as a thin per-player town layer on top of the dynamic layers'
  per-node counts (`dynamicBlockOverlay`, `systems/footprint/blocked.ts`). Do not rebuild a full
  per-player structure every tick: that scales with blocked cells times seats.

Then share one route per group move, which changes the paths soldiers walk and therefore the state
hash, knowingly:

- For the members of a group move that share a start area and a goal area, route the lowest-id member
  and derive the others' routes to join that corridor, all within the same tick. Keep the formation and
  the `reachableMoveGoal` stand-in fan-out behaviour visible in the existing movement tests. Regenerate
  the goldens in the same commit and name the behaviour change in it.
- If the shared route is not enough, the direction is a hierarchical or corridor-reusing search that
  makes each request cheaper, still served in the order's tick.

## Verify

- Headless: a group move of N collider soldiers over one long corridor gives every member its path in
  the order's tick, with the tick's `SearchStats.explored` well below N separate searches; the guard fix
  leaves every path identical to the unguarded search.
- The recipe in `docs/DEVELOPMENT.md` (Measuring performance) writes the checkpoints. With its session
  env, `ON_BENCH_CHECKPOINT=<40k checkpoint> ON_BENCH_TICKS=4000 npm run bench:map` before and after,
  then `npm run bench:compare`, on an idle box, trust clean: `pathfinding` max falls from ~34 ms, and so
  does its part of ticks 43730-43731 in the slowest-ticks list, while the tick in which the last soldier
  of a wave starts stays equal to the tick of the first. The pure half keeps the state hash; route
  sharing moves it and the commit names the behaviour change.
- `npm test`, `npm run check`, `npm run build`.
