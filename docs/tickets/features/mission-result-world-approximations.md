# Replace the world-changing mission result approximations

**Area:** sim · **Focus:** `packages/sim/src/systems/missions/results` · **Priority:** P2

Four frequently used results run, but with a stated approximation in their "Here:" text in the
Results table of `docs/formats/MISSIONS.md`, so the map plays differently from the original:

- `ExploreArea` (1412 corpus uses): a revealed house or landscape uncovers only what its own eye
  sees, where the original reveals the area of any house or landscape on a revealed point.
- `MoveUnitsInArea` (346): each vehicle lands on the first ring node its walk block admits and its
  drive is dropped; the original stacks them and orders each to the point.
- `DockVehicle` (30): the seat's dock order's door-distance ring search stands in for the original's
  radius-9 snap.
- `MissionFailed` (110): the named player's commands stay accepted. Establish what the original lets
  that player do afterwards (its dead flag stays clear) and match it; the HUD side of a refused order
  is [defeated-seat-orders-are-silent](../app/defeated-seat-orders-are-silent.md).

## Scope

- For each result, confirm the original's behavior first (reading or observation) and implement it
  through the existing seams (fog, vehicle orders, the match tables), keeping the sim deterministic.
- Rewrite the result's "Here:" text, keeping any remaining uncertainty.

## Verify

- Sim tests per result: the house/landscape area reveal, stacked vehicles walking to the point, the
  radius-9 dock snap at its boundary, and the post-failure command rule.
- One real-content map per result runs its script without `missionResultFailed`; save/load keeps the
  state hash.
- Normal gates plus `npm run test:content`.
