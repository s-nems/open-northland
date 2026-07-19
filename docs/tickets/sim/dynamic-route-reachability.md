# Extend reachability gating to dynamic blockers (route-level reachability)

**Area:** sim · **Origin:** gathering-economy plan reconciliation, 2026-07-12 · **Priority:** P2

The economy's reachability gate is now partly dynamic. `nearestHarvestableFor`
(`packages/sim/src/systems/agents/targets/resources.ts`) rejects a resource whose resolved work cell is
a blocked goal — buried under a building (the clay/mud-under-a-house case, since those deposits reserve
no build-block so a house can legally land on them). So a gatherer no longer strands on a resource walled
under a building (the deposit's exact fate — un-mined vs side-mined — depends on real-content work-cell
resolution, tracked separately in `clay-work-cell-real-content-resolution.md`). What remains uncovered here
is route-level enclosure: a work cell that is itself clear yet has no path in because a ring of dynamic
blockers (dense resource footprints, a building horseshoe, standing unit bodies) seals it — `findPath`
accepts the goal but finds no route, so the pick still wins and the walk fails.

## What the investigate-first step measured (2026-07-19)

Measured on a real map rather than a stress scene: `npm run soak:gatherers` (the headless twin of
`?map=magiczny_las&player=overseer&ai=0,1,2,3,4,5&fog=reveal`) over 26k ticks, plus a throwaway probe
that replayed the harvest-pick filter per collector. Route-level enclosure is **real and did not
self-heal**: player 2's clay collector went permanently unproductive from tick 19,975 (never recovered
through 26k), parked on the nearest eligible node whose route failed, while **50 routable clay deposits**
stood inside the same flag radius. Player 1's iron collector did the same from tick 22,275. Enclosed
counts per collector ranged from 0 to 86 of the in-radius nodes, so this is common, not exotic.

One half of that was the *pick*, not the park: `releaseStaleIntent` shed the dead route and the
deterministic nearest-first scan re-chose the identical doomed cell every retry. That half is now fixed —
`UnreachableGoals` (`packages/sim/src/systems/agents/unreachable-goals.ts`) remembers recently-failed
goals so the next plan falls through to the next node. It cleared both clay/iron stalls above.

**It is not enough, and this ticket is what remains.** A 40k-tick soak then surfaced a stall the memo
cannot reach: player 3's iron collector, permanently unproductive from tick 25,525, with **113 eligible
iron nodes in radius of which only 12 are routable** and its 8-entry memo saturated. Where enclosed nodes
outnumber routable ones and sit nearer, the FIFO evicts and the collector cycles through the doomed set
forever. The probe showed this is systematic for the dense-footprint goods rather than accidental —
routable fractions per collector at tick 30k: iron 12/113, 11/98, 15/32, 24/60; stone 28/90, 17/49,
27/103; against wood and clay at or near 100%. Growing the memo is the wrong lever (it would need >101
entries here); the pick has to become route-aware.

Still unmeasured: errand-hogging — a parked fetcher keeps its `SupplyRun` counted as inbound for each
park window, so a site behind a permanently enclosed source starves slowly while substitutes defer to
the dead errand.

The pile/delivery drives (`nearestCollectablePileFor`, `nearestOwnDropFor`) already gate on the full
dynamic overlay via `unreachablePickupCell`, so this ticket's remaining scope is the route-level
(ringed-but-clear) case, not the blocked-goal case.

## Scope

- Make the pick route-aware instead of learning by failing: incremental connected-component maintenance
  over the dynamic layer, or a cheap route probe before commitment. Must scale with changed cells, not
  the map (golden rule 6) — a per-candidate `findPath` per gatherer per tick is not viable.
- Measure the errand-hogging case above; if real, release a parked fetcher's `SupplyRun` claim.
- Do NOT "fix" this by growing `UNREACHABLE_GOAL_MEMO_SIZE`: the measurement above needs >101 entries
  for one collector, and the enclosed set grows with the field.

## Verify

- `npm test` — goldens byte-identical unless the fix intentionally changes picks (then name it).
- `npm run soak:gatherers` — the 40k run reports zero collector stalls (today it reports the iron one
  above), and the wasted-query count drops.
