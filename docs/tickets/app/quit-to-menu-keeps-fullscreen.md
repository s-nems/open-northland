# Keep fullscreen when quitting a game to the menu

**Area:** app · **Priority:** P3

Starting a game swaps entries inside the document, so the browser's fullscreen grant survives the
launch. The way back still navigates: `quitToMenu` in `packages/app/src/view/runtime/game-view.ts`
assigns `window.location.search`, which ends the grant, and the menu only takes it back on the
player's next click.

## Scope

- Release a running game the way the menu releases itself. `destroy()` already stops the frame loop,
  the system menu, and the debug seam; the Pixi application, audio driver, HUD nodes, and
  window-level handlers still ride on the page reset.
- Route the quit through `swapToEntry` once that release is complete. Its popstate hook is armed per
  handover, so a second swap in one document has to replace the first rather than add to it.
- `packages/app/src/diag/session.ts` states that its module state resets with the page. Give it
  explicit clearing in the same change.

## Verify

- Enter fullscreen, start a map, quit to the menu: the window stays fullscreen, the menu is
  interactive, and no canvas, HUD node, or audio from the game is left behind.
- Launching again after a quit starts one game, not two.
- `npm test`, `npm run check`, `npm run build`.
