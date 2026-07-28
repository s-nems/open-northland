# Re-measure and flatten the settler planner's scale curve

**Area:** sim · **Priority:** P2
**Blocked by:** [independent benchmark axes](bench-world-scenery-mix.md)

`plannerSystem` is still the heaviest schedule slot, but by a far smaller margin than this ticket used
to record, and for a different reason. Current shares from
`?map=magiczny_las&player=overseer&ai=0,1,2,3,4,5&fog=reveal&debug=profile` at tick ~46 500: `planner`
38.1%, then `combat` 14.0%, `production` 10.6%, `separation` 9.7%, `pathfinding` 9.6%. The old 79-89%
figure predates the spatial memos and no longer holds.

The old attribution is superseded too. A V8 profile of `Simulation.step` over ticks 2000-4000 of the
same world puts the dominant planner work in the builder rung's spacing chain — `planBuilder` →
`siteStand` / `claimWorkCell` → `PlannerSpacing.workCells` → `blockedCells` — not in repeated
store/workplace candidate acceptance. The walk-block copy under that chain is its own bounded fix
([blocked-overlay-copy-per-tick](blocked-overlay-copy-per-tick.md)) and should land first; this ticket
re-measures the planner's shape once that constant is gone.

The curve itself is still unpinned. A partial real-map run over ticks 202-17 701 shows whole-tick
median 8.5 ms → 20.2 ms while settlers grow 634 → 740 (+17%) and buildings 38 → 84 (+121%), pointing
at settlement size rather than population as the driver — but that run was taken on a loaded box and
still blends both axes. The synthetic fixture is what separates them.

## Scope

- Reproduce fixed-map population and fixed-population map-area curves after the benchmark fixture lands.
- Re-profile the planner once the blocked-overlay copy is gone, then optimize the hotspot that
  measurement names, without changing canonical winners.
- Do not add an absolute millisecond gate or optimize old profile data.

## Verify

Report before/after ratios and show cost growing no faster than the active-work axis. `npm run bench:map`
reports that ratio directly in its growth table; `npm run bench:compare` puts two runs side by side.
Goldens and atomic traces remain byte-identical; run `npm test`, `npm run check`, and `npm run build`.
