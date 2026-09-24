# Keep the lattice metric and the step test on integer fast paths

**Area:** sim · **Focus:** nav · **Priority:** P2

Two navigation primitives that every movement, spatial and search path calls cost far more per call
than their arithmetic. On `magiczny_las_12_players` with 13 AI seats (850-1055 settlers between the
30k and 60k checkpoints), profiled timings inflated by the sampler:

- **The stagger shift runs a floating-point modulo.** `staggerShift` (`nav/world-metric.ts`) finds a
  row's place in the two-row cycle with two `fx.mod` calls and an `fx.abs`. `mod` is 3.2-3.9% self at
  every checkpoint and `abs` 0.6-0.7%, all of it under `staggerShift`, which totals 4.6-5.3% of the
  tick. 74% arrives through `nodeHxOfPosition` (`nav/halfcell.ts`, via `nodeOfPosition`, `entityNode`
  and every `NodeBuckets` build) and 14% through `worldDistance`. A `--trace-deopt` run of 300 ticks
  from the 50k checkpoint shows `mod` and `staggerShift` deoptimizing on "not a Smi" and
  `nodeHxOfPosition` on "not int32": a non-Smi number reaches the shared `%`, its feedback widens, and
  every inlined copy of `fx.mod` then compiles to a double modulo. In a standalone benchmark the same
  function costs 2 ns per call on Smi input and 32 ns once its input is a double; an integer form costs
  1.4 ns and 6 ns. Every stored component number after 150 ticks is a Smi-range integer (no `-0`, no
  fraction), so the non-Smi is an intermediate; which one is inferred, not traced (a `-0` from
  `Math.trunc` of a small negative, or from `%` itself).
- **Each step test does two hash lookups.** `TerrainEdges.passable` (`nav/terrain/edges.ts`) is
  3.3-4.6% self and `stepsInto` 6.5% total at 40k. Per call it bounds-checks, reads the node's
  landscape type, looks the type's props up in a `Map` (`propsOf`), and asks the dynamic overlay,
  whose `LayeredBlocks.has` (`nav/block-overlay.ts`) probes up to three large `Set`s: buildings,
  resources, landscapes. `stepsInto` calls it up to 16 times per expanded node, and `walkCost` repeats
  the props lookup for each emitted step. At 40k the expansions come from field reclaim's `probeRoute`
  (36%), A* `runSearch` (36%) and `RouteRegions.regionOf` (25%).

[sweeps-recheck-unchanged-state.md](sweeps-recheck-unchanged-state.md),
[pathfinding-army-march-spike.md](pathfinding-army-march-spike.md) and
[building-blocked-cells-rebuilt-per-construction-advance.md](building-blocked-cells-rebuilt-per-construction-advance.md)
cut how many nodes those callers expand. This ticket is the per-call cost that remains.

## Scope

- Compute the stagger cycle position with integer operations that are exact for every `Fixed` in the
  int32 range (`ONE` is a power of two), returning the identical value for every input, negative rows
  included. `staggerShift` is the only `fx.mod` caller in the sim, so the helper goes with it unless a
  new caller needs it.
- Walkability and walk cost per node as flat typed arrays on the terrain graph, derived from `typeIds`
  and `props` and refreshed when the landscape topology revision moves, so `passable` and `walkCost`
  read one slot.
- The dynamic walk-block overlay (`dynamicBlockOverlay`, `systems/footprint/blocked.ts`) as a
  node-indexed mask kept in step with its three layers, so a membership test is one array read. The
  collider overlay in `drainPathRequests` composes onto it; that part is owned by the pathfinding
  ticket.
- Pure cost work: every path, flood verdict and position stays byte-identical, state hash identical.

## Verify

- Unit: the integer stagger form equals the current formula over positive and negative, odd and even,
  fractional rows; the terrain arrays and the overlay mask follow a landscape edit, a placement and a
  felled resource (a cache verifier under `verifyCaches()`).
- Session and checkpoint recipe: the twelve-player run in `docs/DEVELOPMENT.md` (Measuring
  performance); a checkpoint family from this session's 60k run exists in the worktree's `bench-out/`.
  With the session env, `ON_BENCH_CHECKPOINT=<40k checkpoint> ON_BENCH_TICKS=4000 npm run bench:map`
  before and after, then `npm run bench:compare`: `movement`, `separation`, `fieldReclaim`, `planner`
  and `combat` medians fall, the state hash unchanged. `npm run bench:profile` from the same mark
  lists neither `mod` nor `abs`, `staggerShift` totals under 1%, and `passable` self roughly halves.
- `npm test`, `npm run check`, `npm run build`.
