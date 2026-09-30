# Skip farm work that lies in a disconnected sealed region

**Area:** sim · **Focus:** farming, target selection · **Priority:** P2

A farmer can choose an enclosed ripe field ahead of accessible fields, then announce that it is
lost. `planFarmer` (`systems/settlers/drives/farming/drive.ts`) applies `WorkCellGates` to field
selection, but those gates check only endpoint walkability, dynamic goal blocking, static components
and remembered failures.
Unlike harvest target selection, farming does not consult `RouteRegions.unroutable` before
assigning the work. `nextSowNode` and `nearestFarmSheaf` in the adjacent `targets.ts` share the
same missing connectivity check; their full-schedule consequences still need regression coverage.

Verified with `testContent`, seed 1, `grassNodeMap(30,20)` and the helpers in
`packages/sim/test/economy/farming/support.ts`: place a farm at visual (2,3), its farmer at (1,3),
and a ripe field at node (10,6). Fill the remaining `FIELD_CAP - 1` slots with ripe fields at
(2+i,16), so sowing does not pre-empt harvesting. Surround the nearer field with a synthetic
walk-block overlay at offsets (±1,0), (0,±1), and (±1,±2). `RouteRegions` proves it unreachable,
yet the farmer's `FarmTask` and `MoveGoal` select it and a lost event is emitted within 100 ticks.
Source basis: current simulation behavior, with no signpost restriction in the fixture.

## Scope

- Reject a field, sow point or sheaf when existing bounded region checks prove the farmer cannot
  reach its final interaction cell, retaining the existing dynamic goal-blocking checks.
- Preserve field ownership, work radius, claims, sow randomness and reachable targets in the
  farmer's own region. Do not introduce full pathfinding inside each candidate scan.
- Keep this separate from the existing field-claim key defect: this task concerns selecting
  reachable work, not simultaneous workers claiming it.

## Verify

- Extend farming integration tests with the reproduction above. The farmer starts accessible work
  without first acquiring `Stranded` or emitting `settlerLost`.
- Cover enclosed sow points, thirsty fields and sheaves, and opening a passage to make a previously
  excluded target eligible again. An actually trapped farmer must not select work across its wall.
- Run the standard gates in `docs/TESTING.md`.
