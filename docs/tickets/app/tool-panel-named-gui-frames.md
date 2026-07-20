# Make the tool panel address GUI frames by name instead of raw gfx ids

**Area:** app (hud/tool-panel, content metadata) · **Origin:** ticket scout, 2026-07-20 · **Priority:** P2

`packages/app/src/content/gui-atlas-map.ts:3` states the file's purpose outright: it exists "so app
HUD code refers to UI sprites by name, never by a magic frame number." The tool panel does the
opposite, and it is the only HUD area that does.

Two parallel spellings of the same 193-frame table are in force today:

- **By name** — `hud/minimap/frame.ts:56`, `hud/details-panel/frame-border.ts:100-115`,
  `hud/details-panel/sections/settler.ts:61-62`, `sections/building/general.ts:55-56`,
  `sections/building/stock.ts:79-87` all go through `GUI_FRAME.*`.
- **By raw hex** — `hud/tool-panel/layout.ts:41` (`TOOL_PANEL_STRIP_GFX = 0x33`) and `:63-72`, where
  all ten tool buttons carry a bare `gfx: 0x2a`, `0x2d`, `0x2e`, `0x2c`, `0x32`, `0x2b`, `0x38`,
  `0x2f`, `0x30`, `0x31`.

Every one of those literals already has a named constant. Verified pairs include `0x2a` = 42 =
`GUI_FRAME.tool_button_buildings` (`gui-atlas-map.ts:1439`) and `0x33` = 51 =
`GUI_FRAME.tool_panel_background` (`:1448`).

The result is that **25 of the 38 `GUI_FRAME` entries have zero references outside their own
declaration** — and they are, almost exactly, the frames the tool panel needs:
`tool_button_diplomacy/extras/help/mission/options/statistics/tech_tree`, `tool_panel_background`,
`speed_button`, `speed_button_x2/x3/paused`, plus `message_priority_*`, `resource_icon_*`,
`order_icon_fallback`, `overview_toggle_button` and `bar_frame_96`. The safe spelling is the unused
one.

Why it matters now: 109 of the 193 frames are still named `unknown_NNN` and 173 carry a provisional
`source: 'montage'`. `docs/tickets/app/gui-atlas-confirmation.md` is the pass that will rename and
renumber many of them with the user. On the hex path that pass silently breaks the tool panel while
`packages/app/test/gui-atlas-map.test.ts` stays green, because nothing ties `0x2a` to a name.
Doing this ticket first makes that one safe.

## Scope

- Retype `ToolButtonSpec.gfx` (`hud/tool-panel/layout.ts:46-53`) to `GuiFrameName` and replace the
  ten literals plus `TOOL_PANEL_STRIP_GFX` with the named constants. Resolve to an index at the draw
  seam via `guiFrameIndex()` (`gui-atlas-map.ts:1481`) — `speed-button.ts:67` and `layout.ts:15`
  currently do `atlas.frames.get(spec.gfx)` on a bare number.
- Leave `Chrome.guiCentered(gfx: number, …)` (`hud/details-panel/chrome.ts:84`) taking a number.
  `sections/building/stock.ts:79-87` legitimately computes indices (`GUI_FRAME.stock_tab_0 + 7`), so
  narrowing that parameter to `GuiFrameName` is not possible without reworking the stock tab strip —
  out of scope here.
- Once the panel is converted, re-check which `GUI_FRAME` entries are still unreferenced. Delete the
  ones with no planned consumer, or keep them with a one-line note naming what will use them; do not
  leave a silently dead block.

## Verify

- `npm test` (`gui-atlas-map.test.ts` totality/lock-step plus `tool-panel-layout.test.ts`),
  `npm run check`, `npm run build`.
- Behavior-preserving by construction: each replacement is a literal-for-constant swap at an already
  verified index. A pixel diff in the panel means a pair was mismapped.
- Human eyeball pass on the left tool panel (all ten buttons plus the speed button's state variants)
  — the rendering is visual, so it is not self-signable.

## Source basis

The frame→meaning mapping is the existing `gui-atlas-map.ts` metadata (`source: 'manual'` for the
tool buttons, per its header). This ticket changes how the code *addresses* frames, not which frame
is drawn; it makes no new claim about the original.
