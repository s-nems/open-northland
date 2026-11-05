# Bake the order glyph page before the first game frame

**Area:** app · **Focus:** view/unit-controls/action-ring · **Priority:** P3

The first frame after the map's loading card is a 0.85-1.0 s long task on a Ryzen 7 4800HS with a
Radeon Vega 7 (Windows Chrome 156, `?map=magiczny_las`, CPU profile). About 0.2 s of it is
`bakeIconPage` (`view/unit-controls/action-ring/icon-page.ts`), reached from `mountSettlerActions`: it
renders every order glyph into a texture, reads it back with `renderer.extract.pixels` (about 177 ms
of synchronous GPU readback) and encodes a data URL. The rest of the frame is program and vertex array
setup (about 0.3 s) and texture uploads (about 0.3 s). The player sees the game appear and stop.

## Scope

- Run the bake behind the loading card, before the first game frame. A live device pixel ratio change
  still re-bakes the page as now.
- The ring's glyphs stay the same.

## Verify

A first-run CPU profile (fresh browser profile, `?map=magiczny_las`, Windows Chrome on ANGLE D3D11):
the first frame's long task drops by the bake's time and no other task grows by more than it; the
order ring with a settler selected matches a base screenshot.
