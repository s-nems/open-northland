# Cut steady allocation in ECS query iteration and ring searches

**Area:** sim · **Focus:** ecs, systems/spatial · **Priority:** P2

A late-game session allocates garbage at a rate that feeds its worst frames. GC-inclusive heap
sampling (both `includeObjectsCollectedBy*GC` flags on, without them the rate reads ~1000x low) of
the magiczny_las 6-AI session at speed 3, tick ~28k, rev 38de1846, measures ~9.6 GB allocated over
30 s, ~320 MB/s. Top attributed sources: iterator result objects under `World.query` (`next` is 20.8%
of sampled bytes), scratch in `nodes.nearest` and `forEachIndexNode` (21.4% combined), and snapshot
cloning (since bounded by the touched-log clone cache: clones follow the touched set). GC self time is only
~2.2% of CPU, but worst frames reach 34-58 ms against a 28 ms mean, and the collection cadence rides
this churn.

`forEachIndexNode` no longer exists: the combat index rebuild removed the per-node resolver ladder and
its coordinate objects, so re-measure before assuming the 21.4% row still holds.

## Scope

- Make hot query iteration allocation-free or buffer-reusing where caller structure permits; keep
  iteration order and results identical.
- Reuse candidate buffers in the spatial ring searches (`nearest`, `ringNearest`) instead of
  allocating per call; a shared scratch must never escape into cached or returned state.
- Non-goals: snapshot cloning (separate ticket), changing any search winner or query order.

## Verify

- Repeat the same GC-inclusive heap sampling before/after on one box: the `World.query` iterator and
  ring-search rows shrink materially in bytes share.
- Goldens byte-identical; `npm run bench:map` shows no regression; `npm test`, `npm run check`,
  `npm run build`.
