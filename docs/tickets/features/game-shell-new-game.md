# Build a "new game" flow: map pick, session start, return to menu

**Area:** app · **Origin:** gap-analysis audit 2026-07-13 · **Priority:** P2

The app has no game front-end. `packages/app/src/entries/menu.ts` is a dev scene-launcher: clickable
cards for acceptance scenes / the animation gallery / decoded maps that navigate via
`window.location.search = …` and re-dispatch through `main.ts` — a full page reload per entry, no
session concept. Each entry then runs its own per-entry frame loop (`packages/app/src/view/
frame-loop.ts`). Playing the game currently means knowing the right `?map=` / `?scene=` string;
there is no "start a game on this map, play, quit back to the menu" lifecycle.

Source basis: this is an engine-shell slice, not an original-game mechanic — no fidelity claim
beyond "the original boots to a menu and starts missions from it". Original menu art/flow fidelity
is explicitly out of scope here.

## Scope

Keep it a thin slice: map pick → start → return-to-menu.

1. A "new game" path in the menu: pick a decoded map (the menu's existing `/maps-index` card list is
   the picker seam) and start a real game session on it — reusing the existing `?map=` import path's
   loading (map ground + StaticObjects + HUD) as the session's content.
2. A session/match lifecycle seam above the per-entry frame loop: something owns "a running game"
   (sim + view + HUD + frame loop) with create/teardown, instead of the page-load-is-the-session
   status quo. Full page navigation between menu and game is an acceptable v1 *implementation* of
   the transition, but the teardown/ownership seam must exist so quit-to-menu and a future
   load-game/restart don't each reinvent it.
3. A "quit to menu" affordance in-game (the existing `hud/tool-panel/menu-window.ts` is the natural
   home — check what it already offers).
4. Explicitly out of scope (file follow-up tickets if discovered to matter now): lobby/player-count
   options, difficulty, save/load wiring (docs/tickets/features/save-load-game.md), original menu
   art.

## Verify

- Browser flow: boot → menu → pick map → playing with HUD → quit → menu again, twice in one browser
  session without leaks or double-loops — **user's eyes** on the flow.
- Any extracted lifecycle seam keeps existing entries (`?scene=`, `?anim`, `?map=`) working — run the
  scene suite (`npm test -- scenario`) and spot-check entries in the browser.
- `npm test`, `npm run check`, `npm run build`.
