# Bound a tool-panel list window by the minimap, not just by the screen foot

**Area:** app (hud/tool-panel, hud/minimap) · **Priority:** P2

`tabbed-list/window.ts`'s `listRows()` fits the list to `screenHeight - origin.y - (chrome +
LIST_BOTTOM_MARGIN)`. That clears the screen foot but not the minimap, which is a fixed-size overlay
pinned to the bottom-left corner and drawn *over* the tool panel (`MINIMAP_Z`, mounted after the panel
in `view/runtime/game-view.ts`). The window's x-span starts right of the strip and the minimap panel is
`313` screen px wide at `uiscale` 1.4, so they overlap horizontally at every scale.

A covered row is not merely hidden: `deferToOverlay` makes the panel skip any press the minimap covers,
so clicking a covered row jumps the camera instead of picking the item.

Measured against the real `layoutTabbedList` + `minimapLayout` (200x200 cell map, 13-row cap), as
window-bottom minus minimap-top in screen px:

| uiscale | H=600 | H=700 | H=800 | H=900 | H=1080 |
| --- | --- | --- | --- | --- | --- |
| 1 (goods) | 40 | - | - | - | - |
| 1.4 (goods) | 238 | 194 | 94 | - | - |
| 1.4 (build) | 163 | 63 | - | - | - |
| 2 (goods) | 359 | 339 | 359 | 339 | 199 |
| 2 (build) | 331 | 351 | 291 | 191 | 11 |

Both pop-ups are affected and `uiscale=2` is bad at every tested height. The goods palette reaches it
sooner than the build menu because it drops from the lower `mission` button and carries a second tab row.

## Scope

- Give the pop-up lists the bottom-left overlay reserve they must stay clear of, instead of only the
  screen foot. `PanelContext` is the seam the windows already read the live screen through; the mount
  (`hud/tool-panel/index.ts` via `view/game-tool-panel.ts`) is where `deferToOverlay` is already injected
  from, so the same wiring point can supply the reserve.
- Apply it in the one shared `listRows()`, so both windows are fixed together.
- Only reserve when the window's x-span actually overlaps the minimap panel; a window clear of it must
  keep using the full height.
- Non-goal: changing the minimap or the overlay draw order.

## Verify

Unit-test `listRows()`'s bound against a stubbed reserve. Human seam: `npm run dev` →
`?scene=sandbox&uiscale=2`, open the build menu and the goods palette (`Inne` tab, the longest one) at a
900 px tall window; no row may sit under the minimap braid, and clicking the bottom row must arm the
pick rather than jump the camera.
