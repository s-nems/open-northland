# Skip blocked equipment return points

**Area:** sim · **Focus:** equipment errands, movement targets · **Priority:** P2

A settler can report that it is lost after successfully fetching equipment because the errand sends it
back to a point now occupied by a structure. `dispatchAssistantGrants`
(`systems/settlers/planner/assistant-grants.ts`) captures the current node in `EquipOrder.returnTo`.
`planReturn` (`systems/settlers/drives/equip-order.ts`) checks arrival and the failed-goal memo, then
publishes that raw node as `MoveGoal` without checking whether it remains walkable and clear. The
ordinary stranded recovery emits `settlerLost` before the memo allows the equipment errand to end.
The gear is acquired correctly; the obsolete return leg causes the false loss and recovery delay.

Verified with the full simulation schedule, seed 1, `testContent`, and `grassNodeMap(64,24)`: place
an owned woodcutter at node (10,10), a same-owner loose pile with one pair of shoes (good 8) at
(40,10), disable needs and enable the shoes assistant grant. Wait for the automatically issued
acquire errand to travel at least to column 15. Place a built one-node palisade at the now-vacant
(10,10), using a map landscape type with one blocked walk cell. The fetch equips the shoes, then
requests the blocked return node. It produces a failed `PathRequest` and exactly one `settlerLost`
within 1,500 ticks; the order subsequently ends through the failed-goal memo. The same automatic
errand without the palisade has no failed return or lost event. Source basis: current simulation
behavior and the existing return-stage contract, which says an unreachable issue point ends the
errand. Returning to the issue point is an authored behavior.

## Scope

- Before publishing an equipment return goal, abandon a return point that is unwalkable or dynamically
  blocked. Finish the errand at the current location and let normal planning resume, preserving the
  equipment already acquired.
- Preserve an ordinary return to a usable point, the underfoot completion, skip-return orders,
  queued player intents and the recruit weapon/armor chain. Keep signpost network-loss reporting
  under its existing owner.

## Verify

- Turn the full-schedule assistant-grant scenario above into a regression: shoes remain equipped,
  the order ends, and the covered return point causes neither a failed route nor a lost event.
- Keep the clear-point return control; cover a player equipment errand with the same invalidated
  final point and a queued player intent continuing normally.
- Run the standard gates in `docs/TESTING.md`.
