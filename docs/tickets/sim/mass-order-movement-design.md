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
budget are predicted, not measured, and belong to ticket 00's war scenario.

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
- Out of scope: target selection (`combat-target-search-at-army-scale.md`) and the wall searches
  (`combat-route-searches-outside-budget.md`), though the field design may retire both.

## Verify

- The design section of this ticket names the approach, its per-order and per-tick cost model and its
  sources before code lands.
- On the 00 battle checkpoint: every member of a 400-man order has a route in the order's tick, the
  order tick's cost is within the stated budget, and pathfinding share under contact falls against the
  00 report.
- Goldens and hashes move only where the design names a behaviour change; `npm test`, `npm run check`,
  `npm run build`.
