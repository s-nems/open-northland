# Skip unreachable destinations for a child's stroll

**Area:** sim · **Focus:** family, movement targets · **Priority:** P2

An idle child can announce that it is lost after choosing a stroll across a sealed barrier while
accessible ground remains beside its home. `planChildWander` (`systems/family/wander.ts`) checks
the sampled node's walkability, dynamic blocking and signpost limit, but does not check its route
region or the child's remembered failed goals. The ordinary stranded recovery eventually reports
the failed walk; it does not prevent this selector from requesting unreachable leisure walks.

Verified through the full `Simulation` schedule with `testContent` extended by a synthetic home
and child job, seed 7, and `grassNodeMap(24,24)`: place the home at node (8,12), a male child at
(6,12), and a two-node-wide blocking footprint across columns 9 and 10. Disable needs and run
1,200 ticks, starting `Age.ticks` at `CHILD_AGE_TICKS` so the child remains young. A reachable stroll
to (7,12) exists. At tick 825 the child requests (11,6), which `RouteRegions` proves unreachable;
at tick 874 it emits `settlerLost`. The real `magiczny_las_nations` run also records an enclosed
child-stroll goal at tick 4550 and its lost event at 4599. Source basis: current simulation behavior;
the stroll itself remains an authored approximation.

## Scope

- Reject a sampled stroll destination in another static component, across a provably disconnected
  route region, or in the child's live failed-goal memo. Keep the existing endpoint checks.
- Preserve the current random draws and reachable strolls. Use bounded reachability checks rather
  than a full path search for each roll.
- Keep this separate from spacing drives choosing doors or nooks and from parents' child-making
  orders: this selector chooses a child's optional walk near its own home.

## Verify

- Add a full-schedule child-wander regression with the barrier above: reachable strolls continue,
  sealed destinations acquire neither `Stranded` nor a lost event, and the child remains young.
- Cover a recently failed destination and opening the barrier to admit a previously excluded stroll.
- Run the standard gates in `docs/TESTING.md`.
