# Probe the tool panel's pop-up windows in draw order

**Area:** app (hud/tool-panel) · **Priority:** P2

The statistics window can sit open on top of the build menu or the goods palette: pressing
`statistics` closes only the chest window, and pressing `buildings`/`mission` does not close
statistics (`hud/tool-panel/button-effects.ts`). Their rects overlap - at `uiscale=1` statistics
starts at x 224 and the build menu spans x 56..378, and the menu's top (y 41) falls inside the
statistics span that starts at y 25 (both heights are content-derived: menu rows, HUD tally rows).

`mountToolPanel`'s mousedown probes the windows menu → goods → extras → stats, so statistics is
hit-tested last while it draws on top. A click in the shared region therefore lands on the window
drawn underneath: a press aimed at the visible statistics window can pick a row from the hidden
build menu and enter building placement.

Related but separate: `hud-pointer-dispatch-registry.md` unifies the cross-surface claim chain and
explicitly preserves current precedence; this ticket is the intra-panel window order.

## Scope

- Probe the open pop-ups top-down from one explicit surface order so the visible window takes the
  click. Do not derive it from `windowContainer`'s children: each window appends its text runs at
  open/rebuild time, so child order is dynamic.
- Non-goal: changing window rects, art, or which windows a button closes.

## Verify

Extend `packages/app/test/tool-panel-button-effects.test.ts` (or `tool-panel-controllers.test.ts`)
with an overlapping open pair asserting the topmost window consumes the click. Human seam: in
`?scene=sandbox` open the build menu, then statistics, and click where they overlap - the statistics
window must react, not a menu row.
