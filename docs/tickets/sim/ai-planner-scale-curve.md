# Re-measure and flatten the settler planner's scale curve

**Area:** sim · **Priority:** P2
**Blocked by:** [independent benchmark axes](bench-world-scenery-mix.md)

The last controlled runs attributed roughly 79–89% of tick time to `aiSystem`, with four times the
settlers costing about 7.8 times the planner time. Those numbers predate later spatial-memo and blocker
changes and conflate population with a 3.8-times larger map. A V8 profile still identified repeated
store/workplace candidate acceptance as the dominant planner work, but the current curve is not pinned.

## Scope

- Reproduce fixed-map population and fixed-population map-area curves after the benchmark fixture lands.
- Profile the current worst curve before selecting a cause. Optimize the repeated candidate acceptance or
  another measured hotspot without changing canonical winners.
- Do not add an absolute millisecond gate or optimize old profile data.

## Verify

Report before/after ratios and show cost growing no faster than the active-work axis. Goldens and atomic
traces remain byte-identical; run `npm test`, `npm run check`, and `npm run build`.
