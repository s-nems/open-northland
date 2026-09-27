# Check the main thread's mirror against the worker's world in diagnostic runs

**Area:** app, sim · **Focus:** session/worker, snapshot-mirror · **Priority:** P2

The `?map=` runtime draws, picks and captions from a `SnapshotMirror` fed by deltas, while the world
lives in the sim worker. Nothing at runtime checks that the two agree: the mirror throws on a delta gap
(`SnapshotMirror.apply`), and the bench's `MirrorProbe` compares a headless mirror with the live
snapshot once a window, but a live session never compares its drawn state with the worker's. A
divergence (a missed write, a stale index, a delta that loses a removal) would show as wrong sprites or
wrong HUD numbers with nothing in the diagnostics bundle to say so. The owner wants the view to be
provably the truth.

`hashState` costs 190 to 225 ms at 18 000 entities and the snapshot's JSON is about 10 MB
(`docs/perf/heavy-load-krwawa-rzeka-12ai.md`), so neither can run per batch.

## Scope

- Under `debug=diag`, the worker folds an incremental digest per taken delta (for example an XOR over
  hash(id, component name, serialized value) of the components it carries, updated from the old and
  new clone it already holds) and sends it in the batch; the mirror folds the same digest as it
  patches and compares it on the batch whose last record is the delta's tick.
- A mismatch is logged with the tick and lands in the diagnostics bundle, like an invariant violation.
- The bench's per-window mirror check also compares every runtime index against a fresh walk (shared
  with [mirror-index-upkeep-per-touched-entity.md](mirror-index-upkeep-per-touched-entity.md)).

## Verify

- A unit test that corrupts one mirrored component and one index entry and sees each reported on the
  next batch.
- A late-game `debug=diag` browser session from the reference's t80k checkpoint runs a few thousand
  ticks with no mismatch, and the per-batch cost is stated (target: about 1 ms at t100k).
- `npm test`, `npm run check`.
