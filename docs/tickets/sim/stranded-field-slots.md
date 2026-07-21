# Reclaim a farm plot slot held by a field no farmer can reach

**Area:** sim · **Priority:** P2

`planFarmer` (`packages/sim/src/systems/agents/farming/planner.ts`) counts a standing field toward
`maxFields` BEFORE the reachability gate, deliberately: the plot cap is a fact about the farm, not about
which farmer is asking. The cost is that a field no farmer can reach is never worked and never reclaimed —
it consumes a slot for the rest of the game. A farm can degrade monotonically to zero throughput with no
path back, and nothing in the UI explains why.

`destroyFieldsUnderBuilding` covers only the cells a building makes UNWALKABLE. It is not a general
reclamation rule, and two cases get past it:

- **A field ringed by buildings.** Walls live in the DYNAMIC block overlay, and the overlay never splits a
  static terrain component, so `unreachableWorkCell`'s component check cannot see a sealed pocket. The
  field passes the gate, `findPath` fails, `noteUnreachableGoal` retires it for `UNREACHABLE_GOAL_MEMO_TICKS`,
  and it is re-picked and fails again on the next expiry — forever.
- **A field cut off by terrain edits or a resource spawned onto its work cells** after it was sown.

## Scope

Destroy a field whose work cells stay blocked for a sustained span, the way the placement pass destroys
the ones under walls, so the slot returns to the plot. The rule must not fire on the ordinary transient
case — a settler standing on a work cell, or a farmer mid-swing.

## Verify

- A fixture farm walled around one of its fields reclaims the slot and returns to a full plot.
- A farmer standing on a field's work cell does NOT cause a reclaim.
- `packages/app/test/farm-pacing.test.ts` is unmoved (its sandbox footprints block nothing).
