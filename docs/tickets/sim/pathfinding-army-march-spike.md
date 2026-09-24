# Bound the path search an AI army march queues in one tick

**Area:** sim · **Focus:** movement/routing · **Priority:** P2

Every `pathfinding` spike in the twelve-player late game is one AI wave setting off. On
`magiczny_las_12_players` with 13 AI seats (700-1050 settlers, 210-238 buildings), the quiet profile
from the 40k checkpoint and the busy-machine ones from 50k and 60k show single ticks of 24-44 ms in
`drainPathRequests` against a 0.4 ms median, and they are the largest spike source after the planner.
Replaying the spiking ticks with the searches counted (ticks 43730-43731, 50593, 51510-51512, 51724,
61498-61499, 61922-61923) gives the same picture every time:

- 5-13 requests per tick, all but one or two from soldiers (jobs 33-35) of one seat holding a
  `PlayerOrder`: the `attackMoveUnit` commands `ai-player/military/muster.ts` issues per soldier. Each
  one runs its own collider A* over the same 140-210 node corridor to neighbouring goals.
- A typical member settles 2,300-4,200 nodes at about 1.4 µs each (1.2 µs for a non-collider), so
  one tick settles 15-25k nodes: 24-40 ms. Timings come from an instrumented replay on a busy machine
  and are inflated; the settled-node counts are exact and deterministic.
- `PATHFINDING_NODE_BUDGET_PER_TICK = 16384` (`systems/movement/routing.ts`) is checked before each
  request, so a busy tick only stops once about 16k nodes are settled, which already costs ~23 ms at
  the measured per-settle rate. The budget is sized in the right unit but far above what a 5 ms tick
  allows.
- One member in most spikes routes past `FLOOD_GUARD_MAX_EXPLORED = 4096`
  (`nav/pathfinding/find-path.ts`), so `findPath` runs probe 128 + aborted forward 4096 + goal-side
  exhaust (1.7k-8.3k, ending in `path`, which proves nothing) + a full forward search from scratch
  (4.3k-5.6k). That one request settles 10-17.5k nodes (16-26 ms), of which 55-70% is thrown away.
  The same happens to a civilian: a 98-step route of a woman on a child order settled 12,965 nodes
  at tick 60755.
- A collider's overlay (`blockedFor` in `drainPathRequests`) is a `LayeredBlocks` of 3 dynamic layers,
  the field posts and one set per other player's town, so with 13 seats every neighbour test walks
  up to 16 `Set.has` calls (`TerrainEdges.passable`, `nav/terrain/edges.ts`, is 4.6% of all self
  time at 40k across all its callers).

## Scope

Pure optimisations first, each keeping every returned path byte-identical:

- Stop the guard from discarding work on a legitimately long open route: scale the guard with the
  start-to-goal heuristic (or skip the guard when the probe already left a small pocket), so a
  corridor route runs one forward search. The guard only ever aborts a search with no verdict, so the
  answer cannot change.
- Resolve a collider's overlay into one membership structure per player per tick instead of a
  16-layer view.

Then bound the tick, which changes timing and therefore the state hash knowingly:

- Budget the drain so a tick stops before a request whose expected cost (its heuristic distance
  times a measured settle factor) would push the tick past the budget, with the first request of a
  tick always served. Keep the order ascending entity id so the cut stays canonical.
- Or reuse one route for the members of a group move that share a start area and a goal area:
  route the lowest-id member, and route the others only to join that corridor. This changes which
  path each soldier walks, so it must keep the formation and the `reachableMoveGoal` stand-in fan-out
  behaviour visible in the existing movement tests.

**Gameplay limit option (needs the user's decision):** lowering the per-tick budget to what a 5 ms
tick affords (about 2-3k settles at the measured rate) spreads a 15-soldier march of ~50k settles over
roughly 20 ticks, so the last soldiers of a wave start walking up to ~2 s after the first at x1
speed. Players would see a wave peel off in a trickle rather than step off together. This is the
largest single cut, but it is a visible change and not the default.

## Verify

- Headless: a test that queues N collider requests over one long corridor asserts the settled-node
  total per tick (`SearchStats.explored`) stays under the budget, and that the guard fix leaves every
  path identical to the unguarded search.
- Session and checkpoint recipe: the twelve-player run in `docs/DEVELOPMENT.md` (Measuring
  performance); a checkpoint family from the 60k run of this session exists in the worktree's
  `bench-out/`. Re-measure with `ON_BENCH_CHECKPOINT=<60k checkpoint> ON_BENCH_TICKS=2000 npm run
  bench:map`, then `npm run bench:compare`: `pathfinding` max falls from ~40 ms toward the budget and
  ticks 61498 and 61922-61923 leave the slowest-ticks list. The pure half keeps the state hash; the
  budget or route-sharing half moves it and names the behaviour change.
- `npm test`, `npm run check`, `npm run build`.
