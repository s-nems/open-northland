# Give the synthetic benchmark independent population, map, and scenery axes

**Area:** sim tooling · **Priority:** P3

`packages/app/bench/world.ts` grows map area with settlement count and spawns settlers/fighters but no
resources, berry bushes, or crops. It cannot distinguish population scaling from map-area scaling, so
`npm run bench:sim` reports a single blended curve.

`npm run bench:map` now covers the other half of the old premise: a real decoded map with its scenery
and resource nodes is measured directly, so the synthetic world no longer has to approximate one. What
it still cannot give is axis isolation, which is the reason to keep a synthetic world at all.

## Scope

- Add independent deterministic knobs for map dimensions, active population, and synthetic scenery.
- Derive representative scenery density from counts in a locally decoded map, recording only aggregate
  numbers; never copy map data into the benchmark.
- Keep the default run quick and document reproducible commands for fixed-area population curves and
  fixed-population area curves.

## Verify

The report includes all three input counts and each knob changes only its intended axis. Run
`npm run bench:sim`, `npm test`, `npm run check`, and `npm run build`.
