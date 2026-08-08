# Stop re-plotting every minimap dot every frame

**Area:** app · **Focus:** hud/minimap · **Priority:** P3

`forEachMinimapDot` walks every actor in the snapshot and the dot layer re-rasterizes each frame,
although the minimap changes little frame to frame and reads at a glance, not per frame. In a 45 s V8
profile of the magiczny_las 6-AI session at speed 3, tick ~28k (rev 38de1846), the dot pass
(`forEachMinimapDot` + `drawDots`) is ~2.4% of all sampled CPU, roughly 0.7 ms of a 28 ms frame.

## Scope

- Re-plot on a cadence or when inputs change (snapshot tick, fog generation, camera box, roster
  colours) instead of every rendered frame; a few refreshes per second is enough for dots.
- Keep the existing minimap model and its tests; the ground raster and viewport frame keying are
  already cached and out of scope.

## Verify

- The live probe's profile shows the dot pass amortized across frames.
- Minimap dots still track marches and fights promptly in a human glance at speed 3.
- `npm test`, `npm run check`, `npm run build`.
