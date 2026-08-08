# Decouple frame rate from tick cost with a worker-hosted sim

**Area:** sim, app · **Focus:** runtime loop · **Priority:** P2 · **Complexity:** very high

A frame that carries a sim tick pays tick + snapshot + draw on the render thread; at tick ~23k of
the magiczny_las 6-AI session that is 16-20 ms against an 8.3 ms budget at 120 Hz, and at speed x3
(36 ticks/s) every third frame carries a tick. Cutting individual systems shrinks the spike but the
structure stays: the display's frame budget caps how expensive a tick may ever get. Hosting the sim
loop in a worker removes the cap; the render thread consumes the latest snapshot and interpolates,
and a slow tick costs delivered sim speed instead of frame pacing.

The architecture points this way already: the sim is pure and deterministic with no DOM
dependencies, and `WorldSnapshot` is documented as surviving structured clone at a worker boundary.

## Scope

- Design first, in this ticket: the frame loop today reads live sim seams synchronously each frame -
  `fogView`, `constructionPlots`, placement probes (`canPlaceAt`, `canPlaceSignpostAt`), unit-control
  read models, and the diag/replay seams. Each needs a snapshot-derived, mirrored, or async form
  before the sim can leave the thread. Enumerate them and decide per seam; that inventory is the
  bulk of the work.
- Command flow becomes message passing; determinism and replay recording must survive unchanged
  (the worker owns the canonical loop, the main thread only enqueues).
- Snapshot transfer cost then bounds the boundary; measure structured-clone and postMessage cost on a
  developed snapshot before choosing between the current plain shape and compact lanes.
- Keep a single-thread fallback (tests, headless scenarios, environments without workers).

## Verify

- Same seed and command stream produce byte-identical state hashes worker-hosted and inline.
- Live probe: frame p95 no longer moves with tick cost; delivered speed degrades gracefully
  instead.
- `npm test`, `npm run check`, `npm run build`, plus a headless scenario run.
