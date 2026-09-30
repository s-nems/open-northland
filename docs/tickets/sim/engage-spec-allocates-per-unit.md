# Verify isolated combat context reuse

**Area:** sim · **Focus:** conflict · **Priority:** P2

Per-pass context reuse is implemented on `perf/magiczny-las-low-risk`. Its callbacks and specification
are consumed synchronously before the next unit replaces their inputs; no record is stored in a
simulation component. The combined implementation's allocation result does not isolate its tick cost.

## Scope

Measure the lower-risk subset against the control before closing the standalone performance claim.
Keep target filters, stance ranges, fog rules and attack order unchanged.

## Verify

Compare repeated late-game CPU and allocation windows with matching world, seed and warm-up.
Check final gameplay hashes and the conflict tests, including owner and leash transitions.
See the [branch split](../../perf/magiczny-las-late-game.md#branches-for-separate-review).
