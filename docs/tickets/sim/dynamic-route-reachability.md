# Extend reachability gating to dynamic blockers (route-level reachability)

**Area:** sim · **Origin:** gathering-economy plan reconciliation, 2026-07-12 · **Priority:** P2

The economy's reachability gate covers STATIC components only:
`packages/sim/src/systems/agents/targets/resources.ts` notes "dynamic reachability is a
separate follow-up" (and cites this ticket by path). A target behind dynamically blocked cells (resource
footprints, buildings placed after the static pass) can be picked as "reachable", walk there, and fail.
Since the planner's stranded-route recovery (`systems/agents/ai.ts`, `Stranded`), a failed route no
longer freezes the settler — it parks for the retry pace, re-plans, and typically re-picks the same
enclosed target: a paced retry loop (one path query per episode), visible as a worker standing in
place. The remaining cost is that loop's wasted queries and the un-harvested target, not a freeze —
plus errand-hogging: a parked fetcher keeps its SupplyRun counted as inbound for each park window, so
a site behind a permanently enclosed source starves slowly while substitutes defer to the dead errand
(the investigate-first step should measure this too).

## Scope

- Investigate-first: measure how often dynamic-only blockage actually strands a route today (a
  counter in a stress scene) — if it is rare and self-heals, document and close as a named
  approximation instead of building machinery.
- If real: incremental component maintenance over the dynamic layer (or a cheap route-probe
  before commitment), scaling with changed cells, not the map (golden rule 6).

## Verify

- `npm test` — goldens byte-identical unless the fix intentionally changes picks (then name it).
- Stress scene: stranded-route counter drops to ~0.
