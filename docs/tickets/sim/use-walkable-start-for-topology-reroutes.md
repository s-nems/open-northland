# Start topology-triggered reroutes on walkable ground

**Area:** sim · **Focus:** movement, palisades · **Priority:** P2

Placing or finishing a wall can make a settler report `settlerLost` even when its destination remains reachable.
`settleClosedWall` calls `invalidateRoutesThrough`, whose `haltBefore` calls `requestFromHere`
in `systems/landscape/routes.ts`. That helper truncates the current interpolated position with
`nodeOfPosition`. During a legal diagonal step beside water, this can select the unwalkable flank.
`findPath` rejects that start immediately, and stranded recovery reports the failed walk.

The ordinary `navigationPlanner` already avoids this case with `routeStartCell`, which chooses a
walkable node among the four bracketing the current position. The topology path bypasses that rule.
`invalidateLandscapeRoutes` shares the defective helper. This is a bad request origin, rather than
a demonstrated stale path cache. Source basis: current code and synthetic simulation reproduction.

## Reproduce

- Use `testContent`, seed 1 and `grassNodeMap(16,16)`, changing node (4,5) to water (terrain type 1).
  Register a synthetic palisade type in `map.landscapes.types`: type 691, walk/build offset (0,0),
  no groups, 100 hitpoints, repair-per-strike 1 and a bill of one good type 5.
  Route an owned woodcutter from node (4,4) to (6,8). Its path passes through the diagonal midpoint
  at row 5 and node (5,6).
- Set up the walker on the second half of that diagonal (`PathFollow.index = 2`), with world x 2.35
  and position y 2.7, converting x through `positionXOfWorld`.
- Place a finished one-node palisade at (5,6) through `placePalisade`. The resulting request starts
  at water node (4,5) and fails. A path from (4,4) to (6,8) around the new wall still exists; the
  full simulation emits `settlerLost` within 150 ticks.
- Clear `PathRequest`, `PathFollow` and `PathRoute`, restore that interpolated position and `MoveGoal`,
  then issue the request through `navigationPlanner`: it produces a walkable start and succeeds
  under the identical wall overlay.

## Scope

- Use the same valid route-start rule for ordinary planning and topology-triggered requests.
- Preserve safe stopping and turning during a mid-step reroute, including the retained return leg
  from a closed diagonal. Do not snap a settler across a blocker or change map units.
- Cover wall completion, gate closure and scripted landscape invalidation, including map borders.

## Verify

- Add a regression under `packages/sim/test/movement/` using the reproduction above: a reachable
  detour completes without `PathRequest.failed` or `settlerLost`.
- Keep an actually sealed destination failing, and keep wall/gate traversal prevention tests passing.
- Run the standard gates in `docs/TESTING.md`.
