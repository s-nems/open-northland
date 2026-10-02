# Keep a loitering producer's failed input search off out-of-reach ground piles

**Area:** sim · **Focus:** settlers/targets · **Priority:** P3

Late in a long match the planner's per-tick cost climbs while every other system and the entity count
stay flat. `bench-out/longrun2-branch.jsonl` (browser, `magiczny_las`, 6 hard AI, seed 519132559): the
planner mean is 4.4 ms/tick at tick 316k and 44 ms at 357k. The main run reached only tick 301k and
stayed flat.

Confirmed in the headless `ml6-v79final` world (`magiczny_las` seats 0-5, progression and needs on):

- `bench-out/late-planner-100k-360k.json`: planner window mean 2.7 ms over ticks 300k-340k, 9.35 ms over
  340k-360k. `verifyCaches` at t350000 reports nothing.
- CPU profile `bench-out/late-planner-t350201.cpuprofile`: `nearestMissingInputSource` ->
  `InteractionCellIndex.nearest` -> `looseNearest` takes 15% of the tick (under 1% at t300000). Held
  bands sync 0.5% and the sweep's change feeds 2%; no ring or feed overflow shows.
- Counters over 500 ticks from t350000: 4.9 input searches and 2226 loose candidates weighed per tick,
  2178 of them rejected by the signpost gate. One smith alone runs 2.5 searches per tick: with no iron in
  reach `planProducer` loiters, and a loiterer re-plans every tick (`LOITER_PLAN_PERIOD_TICKS`). Its
  gate's bounds span most of the map, so the ring cap falls through to the linear tail, which resolves
  `interactionCell` for each of the 590 ownerless iron piles before the gate rejects the cell.

The cost is loiterers times piles of the good and grows as reachable deposits run out; main has the
same path. Suspected, not confirmed: the browser's 44 ms is this with more loiterers.
`bench-out/seed519.t100000.checkpoint` is that world, built from the long run's URL.

## Scope

Reject a loose candidate the gate cannot allow before resolving its cell. Add an optional
`SpatialGate.mayAllowNear(x, y, radius)`, false only when no node within Manhattan `radius` is allowed.
`SignpostConfinement` answers it from its own range plus `radius` and a caught-post coverage painted at
range plus `radius` (sound: hex distance obeys the triangle inequality and never exceeds Manhattan
distance). Call it with the index's `slack` in `weighLoose` and the loose branch of `linearNearest`.
A prototype measured planner 7.16 -> 3.94 ms/tick at t350000, state hash identical.

## Verification

- `bench:map` from `bench-out/ml6-v79final.t350000.checkpoint`, `ON_BENCH_TICKS=2000`: planner mean
  back near the t300000 level, state hash unchanged (b39fdb3e).
- Unit tests: `mayAllowNear` sound against `allowsNode` by brute force; a gated-out pile is never resolved.
