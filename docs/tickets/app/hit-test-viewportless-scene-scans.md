# Bound the app-side viewport-less buildSpriteScene scans

**Area:** app · **Origin:** /refactor-cleanup on packages/render, 2026-07-13 · **Priority:** P3

Several app-side callers run `buildSpriteScene(snapshot)` with NO viewport — a full
O(entities) project + depth-sort — for hit-test / tooltip / worker lookups that only
need a handful of ids:

- `view/unit-controls/unit-targets.ts` — `owned()`, `flags()` and `signposts()` now share ONE
  `buildSpriteScene(snap)` + owner map, memoized by snapshot identity (`memoBySnapshot`), so a
  click-release chaining owned→flags→signposts runs one project+sort rather than three
  (refactor/app-cleanup, 2026-07-17). What remains open is the point of this ticket: that shared
  scan is still **viewport-less** — one O(entities) project + depth-sort per snapshot to resolve a
  handful of ids. `enemies()` deliberately keeps its own separate `buildSpriteScene` call: its fog
  gate is mutable per frame, so memoizing it on snapshot identity would not be behavior-preserving.
- `hud/details-panel/worker-sprites.ts:131-132` call `buildSpriteScene(workerScene)`
  TWICE (once plain, once `{ keepIndoorSettlers: true }`) to resolve ~8 worker ids.
  The scene is already narrowed to the workers, so the
  cost is small, but it is still two full passes over the narrowed set where one
  would do.
- `view/ground-pile-tooltip.ts:69-80` (`pileTargets`) — viewport-culled, but its memo
  key includes `cam.offsetX/offsetY/scale`, so during any pan, edge-scroll, or zoom
  glide it misses every frame and re-runs a full `buildSpriteScene` (O(entities)
  classify + visible project/sort) on top of the identical projection the renderer
  just did in `pool.reconcile`. The comment's "while the tick and camera hold still"
  premise rarely holds in an RTS. Found in the 2026-07-17 bug-hunt review.

`render/AGENTS.md` names the O(entities) cull as a known seam; these are the APP-side
consumers of it. `unit-targets` is the load-bearing one (a full-snapshot project+sort
per snapshot on the hit-test path), `worker-sprites` is the cheap double-pass.

**Source basis:** structural (call-count / complexity), not a measured regression —
confirm with a profile on a large map before optimizing `unit-targets`.

## Scope

For `unit-targets`: reuse the renderer's already-built per-frame scene / bounds (the
`WorldRenderer` pool exposes `boundsOf`/`pixelHit`/`anchorOf` — the picker path) instead
of re-projecting the whole snapshot, or pass the camera viewport so the shared scan
is culled. A click and a marquee are both screen-anchored, so a viewport cull cannot lose a real
target — but it is not a strict no-op, so prove the resolved ids are unchanged rather than assuming
it. For `worker-sprites`: fold the two passes into one `collectSpriteScene` call
that keeps indoor settlers and filters, rather than two `buildSpriteScene` calls. Keep
the resolved ids/positions identical. For `ground-pile-tooltip`: same cure as
`unit-targets` — reuse the renderer's already-built frame data (`boundsOf`/`pixelHit`,
or the reconciled item list) instead of a second projection, rather than tuning the
memo key.

## Verify

`npm run build`, `npm test` (app hit-test / details-panel suites), `npm run check`.
Drive the actual flows: click-to-select/target a unit, open a staffed building's
details panel and confirm the worker row still resolves the same settlers.
