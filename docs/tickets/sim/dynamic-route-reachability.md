# Extend reachability gating to dynamic blockers (route-level reachability)

**Area:** sim · **Origin:** gathering-economy plan reconciliation, 2026-07-12 · **Priority:** P2

The economy's reachability gate is now PART dynamic. `nearestHarvestableFor`
(`packages/sim/src/systems/agents/targets/resources.ts`) rejects a resource whose resolved work cell is
a blocked GOAL — buried under a building (the clay/mud-under-a-house case, since those deposits reserve
no build-block so a house can legally land on them). So a gatherer no longer strands on a resource walled
under a building; the deposit is simply left un-mined. What REMAINS uncovered is route-level enclosure:
a work cell that is itself clear yet has no path in because a ring of dynamic blockers (dense resource
footprints, a building horseshoe) seals it — `findPath` accepts the goal but finds no route, so the pick
still wins and the walk fails. Since the planner's stranded-route recovery (`systems/agents/ai.ts`,
`Stranded`), such a failed route no longer freezes the settler — it parks for the retry pace, re-plans,
and typically re-picks the same enclosed target: a paced retry loop (one path query per episode), visible
as a worker standing in place. The remaining cost is that loop's wasted queries and the un-harvested
target, not a freeze — plus errand-hogging: a parked fetcher keeps its SupplyRun counted as inbound for
each park window, so a site behind a permanently enclosed source starves slowly while substitutes defer
to the dead errand (the investigate-first step should measure this too). The pile/delivery drives
(`nearestCollectablePileFor`, `nearestOwnDropFor`) already gate on the full dynamic overlay via
`unreachablePickupCell`, so this ticket's remaining scope is the ROUTE-level (ringed-but-clear) case, not
the blocked-goal case.

## Scope

- Investigate-first: measure how often route-level enclosure (goal clear, no path in) actually strands a
  route today (a counter in a stress scene) — if it is rare and self-heals, document and close as a named
  approximation instead of building machinery.
- If real: incremental connected-component maintenance over the dynamic layer (or a cheap route-probe
  before commitment), scaling with changed cells, not the map (golden rule 6).

## Verify

- `npm test` — goldens byte-identical unless the fix intentionally changes picks (then name it).
- Stress scene: stranded-route counter drops to ~0.
