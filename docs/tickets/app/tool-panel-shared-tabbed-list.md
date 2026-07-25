# Extract one tabbed-list window shared by the build menu and goods palette

**Area:** app (hud/tool-panel) · **Priority:** P2
**Needs user:** the scale-resolution choice (fractional vs integer snap) is a visual fidelity call
against the original; final side-by-side look needs the user's eyes.

`goods-menu.ts` + `goods-window.ts` are a hand-copy of `building-menu.ts` + `menu-window.ts`
(the header admits it: "Twin of `building-menu.js` but for goods"). Both pairs declare their own
`MENU_PAD`/`MENU_TITLE_H`/tab/row constants, their own `{window,titleRect,closeRect,tabs,rows}`
layout type, their own `layout*Menu`, and their own `hitTest*Menu` with the identical
close > tab > row > window precedence.

The copies have already drifted into a player-visible bug: `layoutBuildingMenu` resolves scale as
`Math.max(1, opts.scale)` while `layoutGoodsMenu` uses `Math.max(1, Math.floor(opts.scale))`, so at
the default `DEFAULT_UI_SCALE = 1.4` the two windows draw side by side at different scales. Every
future change (scrolling, new tab, style tweak) must be made twice or the strip drifts further.

## Scope

- One shared tabbed-list layout + hit-test (generic `{tab|row|close|window}` hit union); the
  building and goods variants reduce to a tab source and a row projector. `window-shell.ts` and
  `held-item-banner.ts` show the package's existing pattern for this.
- Resolve the scale question once in the shared code: decide fractional-everywhere or
  integer-snap-everywhere against the original's behavior or the atlas metrics, comment the basis,
  and make all `opts.scale`/`uiscale` consumers agree - the rest of the strip, the extras menu
  (`hud/tool-panel/extras-menu.ts`, fractional like the build menu), and the action ring
  (`action-ring/settler-actions.ts` consumes `uiscale` fractionally), not just these two windows.
- Non-goal: changing menu content, ordering, or window behavior beyond the unified scale.

## Verify

`npm test`, `npm run check`, `npm run build`. Human seam: `npm run dev` → `?scene=sandbox`, open
the build menu and goods palette side by side at `?uiscale=1.4`, `2`, and `1`; the strip must read
as one consistent scale. User signs off.
