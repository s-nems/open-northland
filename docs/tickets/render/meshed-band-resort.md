# Re-sort a fully meshed depth band without rebuilding its instructions

**Area:** render · **Focus:** depth-sorted-layer, still-mesh · **Priority:** P3

On `magiczny_las` t100000 (six hard AI), 1440x900, zoom 0.35, x3, at 4x CPU throttle, the depth bands
still rebuild their Pixi instructions about 80 times a frame: `_buildInstructions` takes about 20 ms of
a 120 ms main-thread frame (17 to 20 ms at 1920x1080 zoom 0.5), and the still mesh's own per-quad work
leads it (`collectBand` 3.7 ms, `place` 3.5 ms, CPU profile). A walker crossing a row re-sorts its band
(`DepthBand.sortByDepth` sets `structureDidChange`), which rebuilds the band's whole instruction list
even when every displayed child is a mesh member and its draws, tables and run boundaries stay the same.

Unthrottled at 1920x1080 on a Radeon Vega 7 (Windows Chrome, ANGLE D3D11), zoom 0.35, x3, 55 to 64 of
142 bands rebuild per frame and `collectBand` takes 4.1-4.5 ms. Per frame about 21 bands only re-sort,
about 20 children cross a band edge and dirty both bands (about 35 band dirties), and about 5 bands
refuse a retexture whose page does not fit the draw's table; the re-sorts are what this ticket removes.

## Scope

- When a band whose displayed children are all mesh members only re-sorts (nothing added, removed,
  hidden, re-tabled or handed to Pixi), write its index buffer in the new order from the members' known
  slots and keep its draws, instead of rebuilding the render group.
- Anything else keeps today's full rebuild.

## Verify

- The still-mesh harness: the drawn order equals Pixi's painter order through re-sorts, migrations and a
  Pixi child arriving.
- An in-process A/B at 4x throttle and unthrottled, zoom 0.35 and 1, x3: `_buildInstructions` calls and
  ms per frame and `app.render` ms drop; draws unchanged; paused shots at zoom 1, 0.5, 0.35 and 2 identical.
