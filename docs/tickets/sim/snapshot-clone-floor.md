# Shrink the per-tick snapshot clone floor

**Area:** sim · **Focus:** inspect/snapshot · **Priority:** P3 · **Complexity:** high

After the touched-entity clone reuse landed, `takeSnapshot` still costs ~2.7 ms per tick at tick
~23k of the magiczny_las 6-AI session (3.1% of sampled CPU in a 30 s V8 profile, and 7.1% inside
>25 ms frame stretches). The floor scales with entities touched per tick - every mover re-clones all
its components through `clonePlain` into fresh objects - so it grows exactly when armies march. At
speed x3 the cost triples per second and lands on the tick frame's critical path; under a
worker-hosted sim it becomes the transfer payload, so it matters on both roads.

## Scope

- Measure the composition first: how much of the per-tick clone walk is Position/anim-style hot
  components on movers versus rare component changes.
- Candidate cuts, smallest first: skip re-cloning components whose value is unchanged even when the
  entity is touched; emit hot per-mover fields into reused compact lanes (arrays keyed by entity
  order) consumed by render, keeping the full clone for the rare rest; only then consider a shape
  change of `WorldSnapshot`.
- The detached-view contract holds: consumers must never reach live stores, and the cache verifier
  (`snapshotClones`) must keep proving coherence.

## Verify

- Live probe: snapMs and `takeSnapshot`'s share drop at an equal-tick comparison point.
- Invariant-checked runs pass with the verifier on; `npm test`, `npm run check`, `npm run build`.
