# Bound the path search an AI army march queues in one tick

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
  request, so a busy tick only stops once it has passed about 16k settled nodes, and the last request
  admitted can overshoot the budget by its whole cost.
- One member in most spikes routes past `FLOOD_GUARD_MAX_EXPLORED = 4096`
  (`nav/pathfinding/find-path.ts`), so `findPath` runs probe 128 + aborted forward 4096 + goal-side
  exhaust (1.7k-8.3k, ending in `path`, which proves nothing) + a full forward search from scratch
  (4.3k-5.6k). That one request settles 10-17.5k nodes, of which 55-70% is thrown away. The same
  happens to a civilian: a 98-step route of a woman on a child order settled 12,965 nodes at tick
  60755.
- A collider's overlay (`blockedFor` in `drainPathRequests`) is a `LayeredBlocks` of 3 dynamic layers,
  the field posts and one set per other player's town, so with 13 seats every neighbour test walks up
  to 16 `Set.has` calls (`TerrainEdges.passable`, `nav/terrain/edges.ts`, is 4.6% of all self time at
  40k across all its callers).

Expected gain: spike only, the `pathfinding` max of 34 ms at 40k and the p99 ticks it tops.

## Scope

Pure optimisations first, each keeping every returned path byte-identical:

- Stop the guard from discarding work on a legitimately long open route: scale the guard with the
  start-to-goal heuristic (or skip the guard when the probe already left a small pocket), so a
  corridor route runs one forward search. The guard only ever aborts a search with no verdict, so the
  answer cannot change.
- Compose a collider's overlay as a thin per-player town layer on top of the node mask that
  [nav-step-primitives-cost.md](nav-step-primitives-cost.md) builds for the three dynamic layers. Do
  not rebuild a full per-player structure every tick: that scales with blocked cells times seats.

Then stop the drain from overshooting its budget, which changes which tick serves a request and
therefore the state hash, knowingly:

- Keep `PATHFINDING_NODE_BUDGET_PER_TICK = 16384`. Stop a tick before a request whose expected cost
  (its heuristic distance times a fixed settle factor) would push the tick's settled nodes past that
  budget, with the first request of a tick always served. The settle factor is a node-count constant
  in code, taken from the counts above, never a runtime timing: the sim reads no clock. Keep the order
  ascending entity id so the cut stays canonical.

**Needs the user's decision:**

- Route sharing: reuse one route for the members of a group move that share a start area and a goal
  area, routing the lowest-id member and the others only to join that corridor. It changes which path
  each soldier walks, so it must keep the formation and the `reachableMoveGoal` stand-in fan-out
  behaviour visible in the existing movement tests.
- Lowering the per-tick budget to what a 5 ms tick affords (about 2-3k settles at the measured rate)
  spreads a 15-soldier march of ~50k settles over roughly 20 ticks, so the last soldiers of a wave
  start walking up to ~2 s after the first at x1 speed. Players would see a wave peel off in a trickle
  rather than step off together. This is the largest single cut, but it is a visible change and not
  the default.

## Verify

- Headless: a test that queues N collider requests over one long corridor asserts the drain stops
  before the request whose expected cost would pass the budget (`SearchStats.explored` per tick), and
  that the guard fix leaves every path identical to the unguarded search.
- The recipe in `docs/DEVELOPMENT.md` (Measuring performance) writes the checkpoints. With its session
  env, `ON_BENCH_CHECKPOINT=<40k checkpoint> ON_BENCH_TICKS=4000 npm run bench:map` before and after,
  then `npm run bench:compare`, on an idle box, trust clean: `pathfinding` max falls from ~34 ms
  toward the budget's cost, and so does its part of ticks 43730-43731 in the slowest-ticks list. The
  pure half keeps the state hash; the budget cut moves it and the commit names the behaviour change.
- `npm test`, `npm run check`, `npm run build`.
