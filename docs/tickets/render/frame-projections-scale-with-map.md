# Make the remaining per-frame snapshot passes screen-bounded, not map-bounded

**Area:** render + sim + app · **Priority:** P1

The app half of this landed: the four app-side per-tick projections (`computeDoorBadges`,
`computeSettlerBubbles`, `forEachMinimapDot`, `familiesByHome`) share one `actorsOf` walk instead of
five, and `buildHud` is built only while the stats window is open. Measured on `magiczny_las`, that
took `snapMs + drawMs` from 17.4 ms to 13.9 ms at `speed=10` and 6.0 ms to 4.6 ms at `speed=1`
(mean of two runs each side; the paused floor stayed at ~3.1 ms, as it must).

Roughly six full `WorldSnapshot.entities` walks remain per tick on that map, which holds ~36 950
entities while ~215 sprites are drawn. Root `AGENTS.md` rule 6 puts per-frame work on the screen.

- `collectSpriteScene` (`render/data/scene/sprite-scene.ts:153`) is the expensive one and it is **not**
  memoized: the retained pool's `reconcile` (`gpu/sprite-pool/sprite-pool.ts:134`) calls it every
  **frame**, not every tick, because its options carry the viewport. It skips `staticRefs` early but
  still probes all ~36 950 ids. The original ticket claimed this pass was per-tick; it is not.
- `enterableStoresOf` and `targetPositionsOf` (`render/data/scene/snapshot-index.ts:85,119`, plus a
  second walk at `:129` when any target exists) and `signpostBoardsOf`
  (`render/data/scene/signpost-boards.ts:42`) are per-snapshot WeakMap memos, so these are per tick.
- `takeSnapshot` (`sim/inspect/snapshot.ts:91`) builds the array and probes the clone cache per id; the
  scenery clone cache spares the cloning, not the walk.
- App, unlisted before: with a non-empty selection the details panel derives a model per tick
  (`hud/details-panel/rebuild-gate.ts:63` returns early only on snapshot identity, and the
  `VALUE_REBUILD_MIN_MS` throttle gates the texture bake, not the derive), and
  `hud/details-panel/model/index.ts:115` resolves the selection by walking `entities`. A selected
  building adds `building-workers.ts:21`, `worker-selection.ts:21,52` and, for a farm,
  `model/building-production.ts:68`.

A spectator session (`?player=overseer`, or `fog=reveal`) is the worst case: `fogView` is null, so no
consumer culls by visibility.

## Scope

Two independent pieces, either one shippable alone:

1. **The details-panel selection walk** (cheapest, app-only). Resolve the selection through
   `entityById`'s binary search instead of walking `entities`: O(k log N) beats O(N) for any real
   selection. It cannot reuse `actorsOf`, because the classifier also reads `Signpost`.
2. **The render passes.** `collectSpriteScene` needs a tested spatial query so the per-frame draw-list
   build tracks the viewport, per the render contract's "add a tested spatial query rather than
   weakening culling". The three per-tick render memos can share one index the way the app side now
   shares `actorsOf`.

Changing the snapshot's own shape (a persistent patched array, or an id-keyed index consumers share)
stays the larger follow-up, out of scope here. Its prerequisite is reliable `World.write` coverage,
noted in [steady-allocation-churn](../sim/steady-allocation-churn.md).

## Verify

`window.__opennorthland.perf()` on
`?map=magiczny_las&player=overseer&ai=0,1,2,3,4,5&fog=reveal&debug=profile`, same tick horizon before
and after, comparing `frame.snapMs` and `frame.drawMs` against the paused-frame floor. Read
`sampling.hidden` first: a background tab throttles the frame loop and voids every millisecond. Take
two runs per side; single runs on a shared machine vary by ~10% on these numbers.

`npm test`, `npm run check`, `npm run build`. Visual output should be unchanged, so a human browser
pass only needs to confirm sprites, door badges, settler bubbles and minimap dots still appear where
they did.
