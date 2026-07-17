# Bound the app-side viewport-less buildSpriteScene scans

**Area:** app · **Origin:** /refactor-cleanup on packages/render, 2026-07-13 · **Priority:** P3

Several app-side callers run `buildSpriteScene(snapshot)` with NO viewport — a full
O(entities) project + depth-sort — for hit-test / tooltip / worker lookups that only
need a handful of ids:

- `view/unit-targets.ts:51` (`owned()`), `:75` (`enemies()`, which passes
  `{ fogVisible }` but still no viewport), and `:89` (`flags()`) each call
  `buildSpriteScene(snap)` to resolve a click/target against the whole snapshot's
  projected items — one full project+sort per lookup.
- `hud/details-panel/worker-sprites.ts:115-116` call `buildSpriteScene(workerScene)`
  TWICE (once plain, once `{ keepIndoorSettlers: true }`) to resolve ~8 worker ids.
  The scene is already narrowed to the workers (see the comment at `:103`), so the
  cost is small, but it is still two full passes over the narrowed set where one
  would do.
- `view/ground-pile-tooltip.ts:67-91` (`pileTargets`) — viewport-culled, but its memo
  key includes `cam.offsetX/offsetY/scale`, so during any pan, edge-scroll, or zoom
  glide it misses every frame and re-runs a full `buildSpriteScene` (O(entities)
  classify + visible project/sort) on top of the identical projection the renderer
  just did in `pool.reconcile`. The comment's "while the tick and camera hold still"
  premise rarely holds in an RTS. Found in the 2026-07-17 bug-hunt review.

`render/AGENTS.md` names the O(entities) cull as a known seam; these are the APP-side
consumers of it. `unit-targets` is the load-bearing one (a full-snapshot project+sort
on every hit-test), `worker-sprites` is the cheap double-pass.

**Source basis:** structural (call-count / complexity), not a measured regression —
confirm with a profile on a large map before optimizing `unit-targets`.

## Scope

For `unit-targets`: reuse the renderer's already-built per-frame scene / bounds (the
`WorldRenderer` pool exposes `boundsOf`/`pixelHit`/`anchorOf` — the picker path) instead
of re-projecting the whole snapshot per lookup, or pass the camera viewport so the scan
is culled. For `worker-sprites`: fold the two passes into one `collectSpriteScene` call
that keeps indoor settlers and filters, rather than two `buildSpriteScene` calls. Keep
the resolved ids/positions identical. For `ground-pile-tooltip`: same cure as
`unit-targets` — reuse the renderer's already-built frame data (`boundsOf`/`pixelHit`,
or the reconciled item list) instead of a second projection, rather than tuning the
memo key.

## Verify

`npm run build`, `npm test` (app hit-test / details-panel suites), `npm run check`.
Drive the actual flows: click-to-select/target a unit, open a staffed building's
details panel and confirm the worker row still resolves the same settlers.
