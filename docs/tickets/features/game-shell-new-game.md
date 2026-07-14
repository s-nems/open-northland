# Add a game-session lifecycle and quit-to-menu flow

**Area:** app · **Origin:** gap-analysis audit 2026-07-13 · **Priority:** P2

The main menu now lists scenes and decoded maps, shows the selected world's preview and settings, and
starts it through `window.location.search`. The missing part is session ownership: a page load still
creates the running view and fixed-timestep loop with no teardown seam or in-game return action.

Source basis: this is an engine-shell slice, not an original-game mechanic — no fidelity claim
beyond "the original boots to a menu and starts missions from it". Original menu art/flow fidelity
is explicitly out of scope here.

## Scope

Keep it a thin slice: own the running session and return to the existing menu.

1. A session/match lifecycle seam above the per-entry frame loop: something owns "a running game"
   (sim + view + HUD + frame loop) with create/teardown, instead of the page-load-is-the-session
   status quo. Full page navigation between menu and game is an acceptable v1 *implementation* of
   the transition, but the teardown/ownership seam must exist so quit-to-menu and a future
   load-game/restart don't each reinvent it.
2. A "quit to menu" affordance in-game (the existing `hud/tool-panel/menu-window.ts` is the natural
   home — check what it already offers).
3. Explicitly out of scope (file follow-up tickets if discovered to matter now): lobby/player-count
   options, difficulty, and save/load wiring (docs/tickets/features/save-load-game.md).

## Verify

- Browser flow: boot → menu → pick map → playing with HUD → quit → menu again, twice in one browser
  session without leaks or double-loops — **user's eyes** on the flow.
- Any extracted lifecycle seam keeps existing entries (`?scene=`, `?anim`, `?map=`) working — run the
  scene suite (`npm test -- scenario`) and spot-check entries in the browser.
- `npm test`, `npm run check`, `npm run build`.
