# Clear an obsolete cut-off marker after a job change

**Area:** sim · **Focus:** settlers, lost notifications · **Priority:** P2

A worker legitimately marked cut off can remain reported lost after changing to a scout, whose
navigation is unrestricted. `reconcileCutOff` (`systems/settlers/drives/cut-off.ts`) returns when
`hasWorkToReach` is false before reaching the branch that clears `LostWay.cutOff`. An idle scout
therefore retains the obsolete marker, and the HUD's snapshot sweep keeps reporting it.

Verified with `testContent`, seed 1 and `grassCellMap(128,8)`: enable signpost navigation, place an
owned woodcutter at visual (60,4) and its only own built home at (2,2), and disable needs to isolate
the idle planner. After 101 ticks the expected cut-off marker exists. Change its job through
`setJob` to scout type 27 and add an own built home at (62,2). `navigationLimitFor` now returns null,
but the marker survives another 300 ticks. A second reproduction changes to unposted carpenter
type 2 instead: the nearby door does not clear the marker either.

Source basis: current simulation behavior. The initial loss outside the network is expected;
the obsolete status after its cause disappears is the defect.

## Scope

- Reconcile an existing cut-off marker even when the current job cannot acquire a new one.
- Clear it when the settler becomes exempt or its settlement comes back within reach. Keep
  `cutOff: false` markers for genuine route failures under their separate recovery rules.
- Let the existing HUD retirement rule remove the note when the corrected marker disappears.

## Verify

- Extend `packages/sim/test/signposts/navigation.test.ts` with scout and unposted-worker job changes
  after acquiring a cut-off marker; confirm it clears on the next reconciliation cadence.
- Keep a genuinely cut-off worker marked, without duplicate events. Check that clearing an
  obsolete cut-off marker does not erase an unrelated failed-order state.
- Run the standard gates in `docs/TESTING.md`.
