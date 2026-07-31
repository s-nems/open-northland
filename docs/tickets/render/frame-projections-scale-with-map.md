# Make the per-frame sprite scene build screen-bounded, not map-bounded

**Area:** render + app · **Priority:** P1

On `magiczny_las` the snapshot holds ~36 950 entities while ~230 sprites are drawn, and root
`AGENTS.md` rule 6 puts per-frame work on the screen. `collectSpriteScene`
(`render/data/scene/sprite-scene.ts`) is not memoized: the retained pool's `reconcile`
(`gpu/sprite-pool/sprite-pool.ts`) calls it every frame, not every tick, because its options carry the
viewport. It skips `staticRefs` early but still probes all ~36 950 ids. It needs a tested spatial query
so the draw-list build tracks the viewport, per the render contract's "add a tested spatial query
rather than weakening culling". A spectator session (`?player=overseer`, or `fog=reveal`) is the worst
case: `fogView` is null, so no consumer culls by visibility.

Two constraints shape the answer:

- `liveRefs`, the build's second product, is viewport-independent and must still exclude `staticRefs`,
  whose set the caller mutates in place between frames. A membership test satisfies every caller: the
  only consumer is the pool's reap, which asks about the <=32 refs one slice swept.
- The app takes ONE snapshot per frame (`view/runtime/frame-loop.ts`) and `Simulation.snapshot()`
  memoizes on tick + mutation version. At 60 fps a snapshot therefore spans ~5 frames at `speed=1` but
  only one frame at `speed=10`.

Filing the drawables into a screen-space bucket grid inside the existing per-snapshot walk was tried
and measured: paused improved 37% and `speed=1` 8%, but `speed=10` regressed 15% (`drawMs` 7.10 ->
9.27), because a grid rebuilt per snapshot is rebuilt per frame once the tick outruns the frame. The
index has to survive across snapshots instead. The sim's scenery clone cache already makes an unchanged
entity's `EntitySnapshot` object identity-stable between snapshots, which is the handle such an index
would reuse; that is the "id-keyed index consumers share" follow-up, whose prerequisite is reliable
`World.write` coverage, noted in [steady-allocation-churn](../sim/steady-allocation-churn.md).

## App: two per-tick walks the panel still runs on a selection

The panel derives its model every tick a selection exists (`hud/details-panel/rebuild-gate.ts` returns
early only on snapshot identity, and `VALUE_REBUILD_MIN_MS` gates the texture bake, not the derive).

- `model/building-production.ts` counts a selected farm's fields by walking `entities`. `Crop` is
  outside `actorsOf`, so this needs its own per-snapshot crops-by-farm memo, like `familiesByHome`.
- `hud/details-panel/worker-sprites.ts` calls `buildSpriteScene` with `onlyRefs` (<=8 settlers) but no
  viewport, so it walks every entity to emit them. The viewport query above cannot help a viewport-less
  call; it needs the same id-keyed lookup the selection classifier now uses.

## Verify

`window.__opennorthland.perf()` on
`?map=magiczny_las&player=overseer&ai=0,1,2,3,4,5&fog=reveal&debug=profile`, same tick horizon before
and after, comparing `frame.snapMs` and `frame.drawMs` against the paused-frame floor, at **both**
`speed=1` and `speed=10`: an index rebuilt per snapshot passes the first and fails the second. Read
`sampling.hidden` first: a background tab throttles the frame loop and voids every millisecond. The
app imports `@open-northland/render` from its `dist/`, so rebuild the workspace on each side or the
browser keeps running whichever was compiled last. Pin the baseline to a commit hash: `main` moves
during a 20-minute measurement. Two runs per side, interleaved; single runs on a shared machine vary
by ~10%.

`npm test`, `npm run check`, `npm run build`. Visual output should be unchanged, so a human browser
pass only needs to confirm sprites, door badges, settler bubbles and minimap dots still appear where
they did.
