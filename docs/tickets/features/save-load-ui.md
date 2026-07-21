# Add save and load controls to the game shell

**Area:** app + desktop · **Priority:** P1
**Blocked by:** [persisted simulation state](save-load-game.md)

Once the sim can export and restore a validated save, players still need a safe way to use it. The
browser and desktop builds currently expose no save or load action.

## Scope

- Add localized Save and Load actions to the in-game system menu.
- Use file download/upload in the browser and the narrow desktop file-dialog bridge in Electron.
- Pause while loading, validate before touching the running game, then dispose every active
  `GameSession` subsystem before installing the restored session. Teardown must cover the RAF loop,
  DOM and canvas listeners, HUD/debug overlays, pointer tracking, and audio; a rejected file leaves
  the current session alive.
- Show clear errors for corrupt, incompatible, or wrong-content saves without exposing local paths.
- Keep autosave, save slots, cloud sync, and migration between incompatible formats out of scope.

## Verify

- Headless app tests cover successful replacement, cancelled selection, and rejected input without
  losing the running session.
- A browser and desktop pass saves a synthetic-content game, changes the world, loads it, and resumes
  from the saved state.
- `npm test`, `npm run check`, and `npm run build`.
