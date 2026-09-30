# Skip blocked and sealed berry targets when seeking food

**Area:** sim · **Focus:** settlers, food targets · **Priority:** P2

`nearestRipeBush` (`systems/settlers/targets/food.ts`) can send a hungry settler to an unreachable
berry bush even when reachable food is nearby. It checks static terrain connectivity, the failed-goal
memo, distance and signpost confinement, but neither whether the resolved interaction cell is blocked
nor whether `RouteRegions` already proves it sealed away. `interactionCell` falls back to the anchor
when no valid stance exists; that fallback still passes the berry picker. The resulting failed walk
parks the settler for the stranded retry interval and raises `settlerLost` before trying other food.

Verified with `testContent`, seed 1 and `grassNodeMap(30,20)`: a ripe bush at node (10,6) survives
12 one-node palisades placed through `placePalisade` on `hexagonRing({hx:10,hy:6},2)`. A hungry
woodcutter at node (2,6) selects it ahead of an accessible ripe bush at (2,16), although
`routeRegions(...).unroutable` proves the nearer bush unreachable. Within 300 ticks the settler
raises one lost event and then forages the farther bush. A second synthetic fixture covering the
bush and all adjacent stances also selects the blocked anchor and raises the event. Neither case
uses signpost restrictions. Source basis: current simulation behavior.

## Scope

- Apply structure standability and proven disconnected-region checks to the final berry interaction
  cell, preserving already-at-target behavior and deterministic distance/id ordering.
- Reuse the bounded region checks used by harvest target selection; do not add an unrestricted
  path search per bush or a scan of every map resource.
- Keep this separate from building-upgrade cleanup: `settleFootprint` already destroys berries in
  the reserved zone. All 234 building footprints and tribe variants inspected in generated content
  have their walk bodies inside that zone; direct burial after upgrade was not reproduced.

## Verify

- Extend the food/forage tests with the enclosed nearer bush and an accessible alternative: select
  the latter immediately, eat successfully, and emit no `settlerLost`.
- With only blocked or proven sealed bushes, do not issue a doomed walk. Keep accessible berries,
  same-pocket access, radius limits and failed-goal memo behavior covered.
- Run the standard gates in `docs/TESTING.md`.
