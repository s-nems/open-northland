# Guard a live session against silent loss: autosave and an unload prompt

**Area:** app, desktop · **Focus:** save/load · **Priority:** P2

Returning to the menu now asks before it throws a session away, but the browser and shell paths do not:
a tab close, F5, or the desktop window's close button drops a live game with no prompt. There is also no
autosave, so a session that ends any other way loses everything since the player's last manual save.

## Scope

- Add a periodic autosave into rotating reserved slots, off the tick path and skipped while the sim is
  paused behind the menu. Rotation must be bounded and visible in the save lists.
- Add an unload guard while a session is live. The in-game load path reloads the page deliberately, so it
  has to suppress the guard before it navigates; the desktop close path needs the same suppression once
  the shell asks.
- Autosave failures must not interrupt play: report through the HUD status line and the diagnostics log,
  never a modal.

## Verify

- An autosave lands at the expected interval, lists like a manual save, and restores to the same state
  hash; a paused menu does not accumulate autosaves.
- Reloading the page mid-session prompts; loading a save from the panel reloads without prompting.
- `npm run check`, `npm run build`, `npm test`, plus a browser and desktop pass.
