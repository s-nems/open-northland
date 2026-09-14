# Move a tool-panel pop-up that cannot shrink clear of the minimap

**Area:** app · **Focus:** hud/tool-panel, hud/minimap · **Priority:** P2

`tabbed-list/window.ts` now sizes its list against `PanelContext.overlayReserve` (the minimap's framed
window), so a pop-up shortens instead of leaving rows under an overlay that swallows their presses.
That closes every case a shorter list can close. Two cases it cannot:

1. **The chrome alone overruns the reserve.** The window's headline + tab grid are a fixed height, so
   once `origin.y + chrome` passes the minimap's top no row count helps. Goods palette (two tab rows,
   dropped from the lower `mission` button), 200x200 map, window-bottom minus minimap-top in screen px
   after the sizing fix:

   | uiscale | chrome ends | minimap top | verdict |
   | --- | --- | --- | --- |
   | 1.4, H=600 | 243 | 321 | +5 covered (`MIN_LIST_ROWS` floor) |
   | 1.75, H=640 | 306 | 291 | +131 covered |
   | 2, H=700 | 348 | 301 | +179 covered |

   `MIN_LIST_ROWS = 3` deliberately outranks the reserve: at 1.4/H=600 dropping to the 1 row that
   would fit is worse than 3 rows with a 5 px sliver covered. The larger scales need placement, not
   size. Only 1.75 stays reachable in play: the HUD scale is the window height over the 768 reference
   capped at `MAX_UI_SCALE_BASE`, times the settings factor (`hud/ui-scale.ts`), so 1.875 is the
   ceiling. 2 and the short-window rows need `?uiscale=`, which pins any scale directly.

2. **`extras-window.ts` cannot shrink at all** - its height follows its content (~173 design px on the
   assistant tab), so at 2x on a short screen its lower stepper rows sit under the same overlay and
   their presses jump the camera.

## Scope

- Give a pop-up that cannot fit above the reserve a placement that clears it, in the one place the
  windows resolve their origin. Two candidates, both a visible HUD change needing human sign-off:
  lift `origin.y` so the window's foot lands on the reserve (it stops dropping from its own button), or
  open the column at `origin.x = reserve.x + reserve.w` when the shifted window still fits the screen
  width (it stops sitting beside the strip).
- Cover `extras-window.ts` too - it shares the column and the same overlay, and its papers tab lists up
  to `PAPER_ROWS_SHOWN` rows (about 290 design px, taller than the assistant tab).
- Non-goal: changing the minimap, the overlay draw order, or the list sizing that already works.

## Verify

Extend the real-geometry case in `test/tool-panel-controllers.test.ts` ("clears the real minimap window
at the shipped uiscales") to the goods palette and to heights 600/640/700/768. Human seam: `npm run dev`
→ `?scene=sandbox&uiscale=2` at a 700 px tall window, open the goods palette; no row and no tab may sit
over the minimap braid, and a click on a bottom row's left half must arm the drop rather than jump the
camera. Repeat at `uiscale=1.75` / 640 px and at `uiscale=1.4` / 600 px.
