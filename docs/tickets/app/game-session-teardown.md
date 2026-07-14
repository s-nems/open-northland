# Complete GameSession teardown for an in-page (no-reload) menu transition

**Area:** app (view/game-session) · **Origin:** game-shell-new-game execution, 2026-07-14 · **Priority:** P2

`startGameView` now returns a `GameSession` (`packages/app/src/view/game-view.ts`) whose `destroy()`
stops the frame loop (`view/raf-loop.ts` stop handle) and removes the system-menu overlay. Quit-to-menu
(`options` tool-panel button → `view/system-menu.ts` → `quitToMenu`) then does a **full-page
navigation** to the menu, so the browser unloads the DOM/Pixi/listeners `destroy()` does not yet cover.
That is the sanctioned v1 transition. A future load-game / restart / quit-*without-reload* needs
`destroy()` to fully tear the session down so a second game started in the same page does not
double-handle input or duplicate stage children.

## Scope

- Extend `GameSession.destroy()` to dispose every mounted subsystem, then flip `quitToMenu` from
  full-page navigation to `destroy()` + in-page `renderMenu(canvas, params)`.
- Subsystems that **already expose** teardown — call them from `destroy()`: `cameraCtl.dispose`
  (deps-owned; the entry may need to hand it over), `controls.dispose` (unit controls — already
  disposes marquee/panel/actions), `toolPanel.controller.dispose`. Their `removeEventListener` calls are
  what a second game would otherwise double-fire.
- Subsystems that **lack** teardown — add a `dispose()` and call it: minimap (`mountMinimap`), perf
  overlay (`mountPerfOverlay`), admin-debug (`mountAdminDebug` returns `void` today), ground pile
  tooltip (`createGroundPileTooltip`), sound driver (`mountGamePresentation` — stop/close its audio),
  pointer tracker (`trackCanvasPointer`), geometry debug overlay.
- Decide the Pixi lifetime: whether the in-page transition destroys the `Application` and rebuilds it
  per game, or clears `app.stage` + restores the `#game` canvas the menu hides (`entries/menu.ts` sets
  `canvas.hidden = true`). The entry (`entries/scene.ts` / `entries/map.ts`) owns `app` creation, so the
  ownership seam likely has to move up to whatever calls `startGameView`.

## Verify

- Browser: boot → menu → game → quit → menu → game, twice in one page load (no reload) with one click =
  one selection (no double-handled input), one RAF loop in the perf overlay, and no residual DOM overlays
  — **user's eyes**.
- Headless: extend the `raf-loop` test pattern — a fake-timer test that a disposed session leaves no
  pending frame and no attached `window`/`canvas` listeners.
- `npm test`, `npm run check`, `npm run build`.

## Source basis

Engine-shell slice, no original-game mechanic — same basis as the parent ticket.
