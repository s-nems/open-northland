# Address tool-panel GUI frames by semantic name

**Area:** app · **Priority:** P3

`content/gui-atlas-map.ts` is the checked-in frame-id-to-name table, but `hud/tool-panel/layout.ts`
still stores the panel background and ten buttons as raw hexadecimal ids. Other HUD areas use
`GUI_FRAME`, so atlas corrections are type-checked everywhere except the tool panel.

## Scope

Retype the tool-panel specs to `GuiFrameName`, replace the verified numeric pairs with existing named
frames, and resolve names to indices at the draw seam. Leave genuinely computed frame runs, such as
stock tabs, numeric.

## Verify

The GUI-atlas and tool-panel layout tests pin every replacement to the same index. Run `npm test`,
`npm run check`, and `npm run build`, then visually check the panel and speed states.
