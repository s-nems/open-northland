# Probe the tool panel's pop-up windows in draw order

**Area:** app (hud/tool-panel) · **Priority:** P2

The statistics window can sit open on top of the build menu or the goods palette: pressing
`statistics` closes only the chest window, and pressing `buildings`/`mission` does not close
statistics (`hud/tool-panel/button-effects.ts`). Their rects overlap - at `uiscale=1` statistics
starts at x 224 and the build menu spans x 56..378, and the menu's top (y 41) falls inside the
statistics span that starts at y 25 (both heights are content-derived: menu rows, HUD tally rows).

`hud/tool-panel/windows.ts` probes the pop-ups in mount order (menu → goods → extras → stats), so
statistics is hit-tested last while it draws on top. A click in the shared region therefore lands on
the window drawn underneath: a press aimed at the visible statistics window can pick a row from the
hidden build menu and enter building placement.

Related but separate: `hud-pointer-dispatch-registry.md` unifies the cross-surface claim chain and
explicitly preserves current precedence; this ticket is the intra-panel window order.

## Scope

- Probe the pop-ups in reverse mount order so the visible (top-drawn) window takes the click:
  `windows.ts`'s `probed` list, which is the one line that changes. Leave the per-frame pass on
  `mounted` - a rebuild re-appends its text runs, so that pass must keep mount order. Do not derive
  either order from `windowContainer`'s children: the runs are appended at open/rebuild time, so
  child order is dynamic.
- Non-goal: changing window rects, art, or which windows a button closes.

## Verify

`packages/app/test/tool-panel-controllers.test.ts` already opens an overlapping pair ("probes the
pop-ups in the pinned order"); invert it to assert the topmost window consumes the click. Human
seam: in `?scene=sandbox` open the build menu, then statistics, and click where they overlap - the
statistics window must react, not a menu row.
