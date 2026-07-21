# Give the sim benchmark independent population, map, and scenery axes

**Area:** sim tooling · **Priority:** P3

`packages/app/bench/world.ts` grows map area with settlement count and spawns settlers/fighters but no
resources, berry bushes, or crops. It cannot distinguish population scaling from map-area scaling and
hides whole-world scans that are cheap only because the benchmark omits most real-map entities.

## Scope

- Add independent deterministic knobs for map dimensions, active population, and synthetic scenery.
- Derive representative scenery density from counts in a locally decoded map, recording only aggregate
  numbers; never copy map data into the benchmark.
- Keep the default run quick and document reproducible commands for fixed-area population curves and
  fixed-population area curves.

## Verify

The report includes all three input counts and each knob changes only its intended axis. Run
`npm run bench:sim`, `npm test`, `npm run check`, and `npm run build`.
