# Bound one AI seat's decision pass

**Area:** sim · **Focus:** ai-player · **Priority:** P2

Implementation is isolated on `perf/magiczny-las-low-risk`; its standalone timing comparison remains open.

## Scope

Compare this subset against the benchmark control before accepting its performance claim.
Keep decision cadence, gameplay state and draw order unchanged.

## Verify

Run repeated late-game timing windows with matching seed, checkpoint, warm-up and workload.
Check the resulting gameplay hash and relevant ordering tests; report median and tail costs.

See the [branch split](../../perf/magiczny-las-late-game.md#branches-for-separate-review).
