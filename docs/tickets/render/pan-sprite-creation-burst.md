# Amortize the sprite-creation burst when panning into a populated area

**Area:** render, app · **Focus:** sprite-pool · **Priority:** P3

Panning across magiczny_las at tick ~23k (rev fb833032) grew the pool 285 -> 1056 entities in 20 s
and produced a 341.9 ms worst frame with 30 frames over 30 ms, while the static camera in the same
session peaked at 74 ms. Newly scrolled-in entities pay `LayerBinder.create` plus first-use texture
and GL-buffer uploads inside the frame they appear; a 68 ms `getGlBuffer` stretch shows up in the V8
profile when fresh sprite batches first draw. The reap side is already budgeted
(`POOL_REAP_BUDGET`); creation is not.

## Scope

- Profile a pan with `?debug=trace` first to split binder cost from GL upload cost; bound the larger
  term (a per-frame creation budget for scrolled-in sprites, or pre-warmed bindings/uploads for the
  near-viewport ring).
- Keep pool identity and reap semantics; culled entities must still re-attach instantly.

## Verify

- Repeat the pan probe: worst frame and the >30 ms count drop toward the static-camera envelope.
- Human review of a fast pan across a settlement: no visible popping beyond a frame of delay.
- `npm test`, `npm run check`, `npm run build`.
