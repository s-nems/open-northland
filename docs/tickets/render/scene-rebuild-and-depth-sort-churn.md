# Bound the per-tick depth sort of the scene rebuild

**Area:** render · **Focus:** data/scene · **Priority:** P3 · **Complexity:** medium

Implementation is isolated on `perf/magiczny-las-low-risk`; its standalone timing comparison remains open.

## Scope

Compare this subset against the benchmark control before accepting its performance claim.
Keep decision cadence, gameplay state and draw order unchanged.

## Verify

Run repeated late-game timing windows with matching seed, checkpoint, warm-up and workload.
Check the resulting gameplay hash and relevant ordering tests; report median and tail costs.

See the [branch split](../../perf/magiczny-las-late-game.md#branches-for-separate-review).
