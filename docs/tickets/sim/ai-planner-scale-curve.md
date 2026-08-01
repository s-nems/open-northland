# Separate the planner's population axis from its map-area axis

**Area:** sim · **Priority:** P3
**Blocked by:** [independent benchmark axes](bench-world-scenery-mix.md)

A real-map run blends population, buildings, scenery, and map area. Its whole-tick median rose from
8.5 ms to 20.2 ms while settlers grew 17% and buildings grew 121%, so it cannot identify the
planner's driver. The planner is no longer the largest system, but its remaining growth curve is
unpinned.

## Scope

- Measure fixed-map population and fixed-population map-area curves with the independent benchmark axes.
- Report ratios against the changed active-work axis; do not add an absolute millisecond gate.
- Attribute a follow-up only when the profile names a planner-owned term.

## Verify

- Compare two trusted runs with `npm run bench:sim` and `npm run bench:compare`.
- Goldens and atomic traces remain unchanged; run `npm test`, `npm run check`, and `npm run build`.
