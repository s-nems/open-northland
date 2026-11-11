# Design responsive movement for a mass order

**Area:** sim · **Focus:** movement, orders · **Priority:** P2

The owner's requirement: a player order to a large army starts every member moving at once and the army
stays responsive to the next order, at hundreds of fighters per side. The original's staggered start,
where a group trickles into motion, is a defect this implementation must not reproduce
(`packages/sim/AGENTS.md`: a group order starts every member moving in the tick it applies, cut its path
cost with cheaper searches, never by rationing its requests).

What exists: one path request per member; `drainPathRequests` (`movement/routing.ts`) exempts
`PlayerOrder` holders from the per-tick node budget (`PATHFINDING_NODE_BUDGET_PER_TICK`, 16384) so the
order's tick pays every member's search; `GroupRoutes` (`movement/group-routes.ts`) lets a member whose
start and goal lie near another member's route borrow its corridor in the same tick. Every other
requester (chase, flight, work) queues behind the budget in ascending entity id, so under load the
lowest ids route every tick and the highest ids wait, which shows as part of a group frozen while the
rest moves.

Measured so far, without a battle (`docs/perf/heavy-load-magiczny-las-6ai.md`): pathfinding 6% of the
tick at 1000 fighters with a 100 ms per-tick max, `findPath.advance` and `stepsInto` most of it. A
mass order into contact, hundreds of chase repaths per tick and the wall and seal searches outside the
budget are predicted, not measured; a deterministic mass-battle scenario would measure them.

Measured on the order tick itself, six-AI `magiczny_las` from the t100000 checkpoint, seat 5's 277
fighters attack-moved 256 nodes to node 154,37 at tick 100400 (`ON_BENCH_MARCH_TICK`,
`docs/PERFORMANCE.md`), settles in the path drain:

- The order tick settles 144,327 nodes, 45-50 ms of pathfinding on an idle machine. Every member
  routes in that tick. Three band searches are 75,000 of it: the first band's full search (37,000) and
  two further bands' searches onto its route (23,000 and 15,000). About 230 members' joins onto a
  band's route are 61,000: the leg onto the route 19,000 and the leg off it by the slot 42,000 (median
  9 settles, 90th percentile 457, largest 2,263), with 59 and 38 members leaving one route at the same
  node.
- A member served by a lane or a join walks a route 1.07 times the cost of its own full search on
  average, 1.27 at the 90th percentile and 1.9 at worst (224 members); on `diamentowa_dolina` t80400
  with 300 fighters 1.03 on average and 1.3 at worst. A member whose own search ends on a band's route
  walks 1.03 on average and 1.13 at worst.
- A march under the 96-node sharing minimum shares nothing: on `arabskie_wyspy` t100400, 300 fighters
  with routes of 33-92 nodes run one search each, 116,110 settles. Sharing from 32 nodes cuts that to
  42,859 but the lanes and joins then cost 1.13 times a member's own search on average, 1.47 at the 90th
  percentile and 1.69 at worst.
- One cheapest-first flood per 96-node stretch of a route, serving every member boarding or leaving
  there, settled more than the legs it replaced (199,000 in the order tick): a flood has to start from
  one exit node, not a stretch.

## Scope

- Investigate first, then write the design into this ticket before implementing: survey how shipped
  lockstep RTS engines move hundreds of units on one order (flow or vector fields computed once per
  destination and shared by the whole group, hierarchical or clustered pathfinding with a coarse graph
  and local refinement, corridor plus steering, path caching keyed on goal region), what each costs per
  tick and per order, and how each behaves with dynamic blockers (buildings, palisades, standing units)
  and the half-cell lattice here. Cite published sources; no engine code.
- Then a design that fits the sim contract: one search or field per order or destination cluster,
  shared by members deterministically; the order's tick bounded by the number of distinct destinations,
  not members; the chase and flight repaths served without starving anyone (a fair schedule or a shared
  field per target); a stated budget per tick and what happens when it is exceeded. Determinism is a
  hard requirement: same seed and input, same state, independent of member count order.
- Prototype the chosen approach behind the existing `PathRequest` seam and measure on the 00 battle
  checkpoint at 100, 400 and 1000 fighters: order-tick cost, ticks until the last member moves, and
  pathfinding share under sustained contact.
- Out of scope: target selection and the vehicle engagement's search
  (`combat-route-searches-outside-budget.md`), though the field design may retire both.

## Verify

- The design section of this ticket names the approach, its per-order and per-tick cost model and its
  sources before code lands.
- On the 00 battle checkpoint: every member of a 400-man order has a route in the order's tick, the
  order tick's cost is within the stated budget, and pathfinding share under contact falls against the
  00 report.
- Goldens and hashes move only where the design names a behaviour change; `npm test`, `npm run check`,
  `npm run build`.
