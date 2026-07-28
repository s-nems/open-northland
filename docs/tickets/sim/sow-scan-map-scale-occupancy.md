# Bound the farmer's sow scan to the farm's field ring

**Area:** sim · **Priority:** P2

`buildSowScan` (`systems/settlers/drives/farming/targets.ts`) builds its `occupied` set by walking
`targets.resources` and `targets.stockpiles` in full — every standing resource on the map, 35 170 of
them on `magiczny_las` — to stamp one node per entity. The consumer, `nextSowNode`, then probes that
set only inside the farm's `fieldRadius` ring around a single farm anchor.

The scan is memoized per tick on `FarmClaims.sowScan`, so the cost is paid once per tick rather than
once per farmer, but it is still a map-scale build serving a settlement-scale question. Per the
project's scaling budget, per-tick work must track active work, and a farm's field ring is the active
work here.

## Evidence

V8 CPU profile of `Simulation.step` over ticks 2000-4000 of
`?map=magiczny_las&ai=0,1,2,3,4,5&fog=reveal`: `buildSowScan` 5.5% inclusive, of which `occupy` alone
is 4.5% self. Census on the same world reports 35 170 `Resource` entities from tick 0 onward, so the
cost is flat across the game rather than growing with the settlement.

A sampling profile inflates absolute time and over-weights tight loops; treat the share as a ranking
and pin the real number with the A/B below.

## Scope

Derive `occupied` from the memoized resource region index (`resourcesNearNode` /
`systems/spatial/resources.ts`) and the stockpile candidates within the farms' field rings, instead of
the whole-map candidate lists. The scan is shared by every farmer in the tick, so the bound is the
union of the active farms' rings, not one farm's.

The winner must stay canonical: `nextSowNode` picks by `(distance, cell-id)` over a lattice walk, so a
narrower `occupied` may only remove nodes that were provably outside every farm's radius.

The `blocked` half of the same `SowScan` is covered by
[blocked-overlay-copy-per-tick](blocked-overlay-copy-per-tick.md); take that one first, since it
changes this function's other line.

## Verify

`npm test` with no golden or atomic-trace movement — a moved golden means a sow node changed, which
this must not do. The existing farming suites must pass unchanged.

`npm run bench:compare` before and after on `magiczny_las` with enough ticks for farms to be sowing
(the AI reaches its farm entries well before 20k), plus `npm run check` and `npm run build`.
