# Draw only the depth bands that reach a portrait inset

**Area:** render · **Focus:** world-renderer, sprite-pool · **Priority:** P3

With a settler or building panel open, the portrait inset costs about 1.3 ms of main thread per frame
on a Ryzen 7 4800HS (`bench:hud` `settler` and `building` against `none`, `magiczny_las` t100000,
1920x1080, x3, CPU profile): 0.70 ms of draw calls and 0.27 ms of render-group update over the whole
world. `toInset` (`gpu/world-renderer/world-renderer.ts`) keeps every depth band within
±`SPRITE_CULL_MARGIN` (512 world px) of the inset's box. At zoom 1 that spans nearly the whole screen,
so a portrait-sized box redraws nearly every sprite-layer batch.

## Scope

- Keep the bands from the box's top minus the largest upward reach to its bottom plus the largest
  downward reach. The per-kind reaches in `gpu/sprite-pool/cull-reach.ts` cover pooled kinds only, so
  first give the other band children (tall map objects, badges, shots, collapse bodies) a named bound.
- The inset's picture stays the same.

## Verify

`bench:hud` `settler`, `building` and `none`, base and branch alternating twice: script ms per frame;
the `bench:gpu` `panel-paused` screenshot with 0 differing pixels.
