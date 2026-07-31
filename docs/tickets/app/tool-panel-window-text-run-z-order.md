# Give each tool-panel pop-up its own container so text draws with its window

**Area:** app (hud/tool-panel) · **Priority:** P2

Every pop-up parents its frame layers under the shared `windowContainer` at construction, in
`MOUNT_ORDER`, but parents its text runs there at open/rebuild time. Child order is draw order, so
every window's labels draw above *every* window's frame, whatever the mount order says.

Visible today: with the build menu open under the statistics window, the menu's last two tab labels
render on the statistics panel while their plates stay hidden behind it. At `uiscale=1` those tabs
span x 248..372, y 59..77, and the statistics rect is x 224..374, y 25..95 at `layoutHud`'s four-row
minimum. The goods palette's fourth tab column overlaps the same way.

`windows.ts` now probes the pop-ups in reverse mount order (top-drawn first) for clicks, the wheel,
and hover, which is correct for the frames but cannot be correct for text until this is fixed.

## Scope

- Give `createWindowShell` its own `Container`, parented under the panel's window container, and put
  that window's layers and text runs inside it. The extra layers to move with it are the build menu's
  `back` and hover graphics and the extras window's `back`. Mount order then holds for frames and
  labels alike.
- Non-goal: changing window rects, art, hit regions, or the probe order itself.

## Verify

Add a case that a menu rebuild while statistics is open leaves the menu's runs below the statistics
frame. `packages/app/test/tool-panel-controllers.test.ts` needs one update: `hasRowHighlight` reaches
the menu's hover layer as the shared container's third child, which this change invalidates - resolve
it through the menu's own container instead. Human seam: in `?scene=sandbox` open `buildings`, then
`statistics` - no menu labels may appear on the statistics panel. Repeat with `mission` +
`statistics` for the goods palette.
