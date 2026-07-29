# Separate the planner's population axis from its map-area axis

**Area:** sim · **Priority:** P3
**Blocked by:** [independent benchmark axes](bench-world-scenery-mix.md)

`plannerSystem` no longer holds a hotspot, and is no longer even the heaviest slot. At 24.4% of
`Simulation.step` it sits behind `combatSystem`, and its cost is the drive ladder itself, spread thin
across rungs with nothing dominant left to flatten. What remains here is purely a measurement
question: which axis actually drives what is left.

## Measured at bf13ebdc

V8 CPU profile of `Simulation.step` over ticks 2000-4000 of
`?map=magiczny_las&ai=0,1,2,3,4,5&fog=reveal`, 5.83 ms per tick at a 1-minute load of 0.56-0.63 per
cpu, inside the 1.5 the report's own trust gate allows. Inclusive shares of `step`:

| chain | share of step |
| --- | --- |
| `combatSystem` | 31.0% |
| `plannerSystem` | 24.4% |
| → `planAdult`, the whole adult ladder under it | 11.1% |
| → `beginPlannerPass`, the shared per-tick pass state | 4.5% |
| → `PlannerSpacing.forTick` occupancy buckets + sorts | 1.0% |
| `planBuilder`, `planFarmer`, `nextSowNode` | each out of the top 40, so under 4.3% |

Three recorded attributions are now superseded. The 79-89% planner figure predates the spatial memos.
The `planBuilder` → `siteStand` → `PlannerSpacing.workCells` → `blockedCells` chain recorded at 11%
was the walk-block union copy, removed in c5a64288. The farmer's sow scan that replaced it at the top
was removed in c70b50e9. Both rungs have dropped out of the ranking entirely, and the `planner` 38.1%
/ `combat` 14.0% split has inverted.

Measure this on an idle box or not at all. The same profile taken beside another suite (11 load per
cpu) ranked the chains identically but inflated the planner by 2-3 points and the whole tick from
5.8 ms to 46-200 ms. Contention distorts the shares, not just the timings.

## Scope

The curve itself is still unpinned, and a real-map run cannot pin it. A partial run over ticks
202-17 701 shows whole-tick median 8.5 ms → 20.2 ms while settlers grow 634 → 740 (+17%) and buildings
38 → 84 (+121%), pointing at settlement size rather than population as the driver, but it blends both
axes and was taken on a loaded box. The synthetic fixture is what separates them.

- Reproduce fixed-map population and fixed-population map-area curves once that fixture lands.
- Do not add an absolute millisecond gate.
- If the curve names a term to cut, check it is the planner's own: the heaviest per-tick spatial work
  now belongs to combat ([combat-spatial-rebuild-per-tick](combat-spatial-rebuild-per-tick.md)).

## Verify

Report cost growth against the active-work axis as a ratio. `npm run bench:map` reports that ratio in
its growth table; `npm run bench:compare` puts two runs side by side. Take them on an idle box: the
report flags a contended machine, and a flagged report is void rather than a result. Goldens and
atomic traces remain byte-identical; run `npm test`, `npm run check`, and `npm run build`.
