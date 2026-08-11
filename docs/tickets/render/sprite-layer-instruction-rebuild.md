# Cut the per-frame Pixi instruction rebuild of the moving sprite layer

**Area:** render · **Focus:** world-renderer · **Priority:** P3 · **Complexity:** high

After the frame-CPU cuts (scene-build reuse, map-object frame memo, sprite-layer render-group
isolation), the dominant draw term was the sprite render group itself: a moving on-screen unit
re-writes zIndex, so Pixi re-sorts and re-builds that group's instruction set (live magiczny_las probe
at tick ~24k, 161 drawn, 2048x1048: `_buildInstructions` ~0.98 ms + `sortChildren` ~0.17 ms of the
2.38 ms running draw EMA; both drop to 0 when paused). The cost scales with attached containers, so a
big battle or city view multiplies it.

**That measurement predates walkers stepping on the sim tick.** A walker now writes the same position
and zIndex on every frame inside a tick, and Pixi early-returns on an unchanged value, so the rebuild
should now fire on tick boundaries rather than every frame. Re-run the probe below before scheduling
this work: the remaining cost may not justify the flattening.

## Scope

- Fewer nodes under the sprite layer: each pooled entity is a `Container` holding its layer
  sprites, and each tall map object attaches its own `Sprite` (plus a shadow twin). Flattening
  either - single-sprite entities without a wrapper, or batch-friendly tall objects - shrinks the
  per-frame walk. Measure per candidate before cutting: `window.__opennorthland.renderer` exposes
  the layer objects at runtime, so a page-side wrapper around `_buildInstructions`/`sortChildren`
  attributes the cost without instrumenting source.
- A camera pan also rebuilds the sprite scene every frame (~0.55 ms at 161 drawn); reusing the
  DrawItem array across pan frames is the remaining allocation cut if pans show up in profiles.
- `PalettedSprite.place` calls `vars.update()` unconditionally, so every settler mesh re-uploads its
  placement UBO every frame even though origin, scale and canvas size now hold still between ticks.
  An unchanged-value early return is the same measurement question as the rebuild above.
- Painter order and fog gating must stay byte-identical; the shot comparison
  (`npm run shot`, synthetic + `--map magiczny_las --terrain`) must stay pixel-identical.

## Verify

- Running drawMs falls on the live probe with unchanged paused floor (~0.8 ms).
- `npm test`, `npm run check`, `npm run build`, plus human review of one live session.
