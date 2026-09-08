# Cut what the sync digest folds each tick

**Area:** sim · **Priority:** P3

`Simulation.setSyncDigest` folds every component value a tick wrote, which is what lets a lockstep
session compare ticks without the full state hash. It costs about 11.8k mixed words over roughly 510
values a tick on `magiczny_las` with six AI seats. Measured in one process with the two paths
interleaved per tick, that came out between 5% and 17% of a settled tick across three runs, on a box
too loaded to narrow further. The seam it was built for asked for under 0.2 ms, roughly 6% of a
settled tick there, so the budget is probably still missed.

Three components carry about 90% of the fold: `Settler`, whose experience `Map` is re-folded whenever
any of its fields moves, `CurrentAtomic`, and `PathFollow`, whose route array is re-folded on every
step along it though it only changes on a reroute.

## Scope

Bring the per-tick fold well under a tenth of a settled tick without weakening what it detects: every
state a run can diverge in must still move a digest domain.

Two levers, in the order their measurements justify them. Split the rarely-written payload out of each
of the three hot components into its own store, so a step along a route stops re-folding the route;
that is a component-layout and save-format change, and it needs no new digest machinery. Then decide
deliberately whether the digest must seal every tick: accumulating the touched sets across an N-tick
window and sealing at the boundary folds a per-tick component once per window instead of N times, and
stays a pure function of the state at the seal tick, but it names a window rather than a tick when two
clients part.

A depth or size cut that stops folding part of a value is not in scope: it trades away the property
the digest exists for.

## Verify

- The digest sequence keeps its shape: the same inputs still produce identical sequences, and the
  perturbation cases in `packages/sim/test/core/sync-digest.test.ts` still name one domain each.
- `npm run bench:map` with `ON_BENCH_TICKS=4000` and `ON_BENCH_SYNC_DIGEST=on` against the same run
  with it off, on an idle box, reports the added cost per tick in the last window.
- `npm run check`, `npm run build`, `npm test`.
