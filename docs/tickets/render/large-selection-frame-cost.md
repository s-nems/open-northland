# Cut the per-frame cost of a large selection

**Area:** render · **Focus:** sprite-pool, selection effects · **Priority:** P3

Selecting 220 settlers costs about 12 ms of script per frame on a Ryzen 7 4800HS: `bench:hud`
`select50` against `none-zoomed` (`magiczny_las` t100000, 1920x1080, zoom 0.5, x3) reads 33.5-34.4
against 21.6-22.0 ms in two runs. A CPU profile places about 9.6 ms of it: Pixi render +4.0 ms
(`_updateRenderGroups` +3.3, `_buildInstructions` 3.1 to 5.3, still-mesh `collectBand` 2.8 to 4.1),
native time outside JavaScript +5.4 ms, and sprite-pool `reconcile` +1.2 ms. The selection style
(outline, white ring, pulse) moves the total by about 3 ms only. An emphasised entity never holds
still: `SpritePool.applySelection` (`gpu/sprite-pool/sprite-pool.ts`) reports an emphasis for every
style, so each selected entity is presented every frame, and its outline quads keep their bands'
instructions changing.

## Scope

- Attribute the native 5.4 ms first: WebGL calls and draws per frame with and without the selection,
  and a GPU-process trace.
- Then cut the largest attributed part with the selection's picture unchanged.

## Verify

`bench:hud` `select50` and `none-zoomed`, base and branch alternating twice: script and task ms per
frame; the `bench:gpu` `select10-paused` and `select50-paused` screenshots with 0 differing pixels or
each difference explained.
