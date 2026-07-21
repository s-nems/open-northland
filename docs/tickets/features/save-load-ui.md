# Add save and load controls to the game shell

**Area:** app + desktop · **Priority:** P1
**Blocked by:** [persisted simulation state](save-load-game.md)

Once the sim can export and restore a validated save, players still need a safe way to use it. The
browser and desktop builds currently expose no save or load action.

## Scope

- Add localized Save and Load actions to the in-game system menu.
- Use file download/upload in the browser and the narrow desktop file-dialog bridge in Electron.
- Pause while loading, replace the active game only after validation succeeds, and keep the current
  session alive when a file is rejected.
- Show clear errors for corrupt, incompatible, or wrong-content saves without exposing local paths.
- Keep autosave, save slots, cloud sync, and migration between incompatible formats out of scope.

## Verify

- Headless app tests cover successful replacement, cancelled selection, and rejected input without
  losing the running session.
- A browser and desktop pass saves a synthetic-content game, changes the world, loads it, and resumes
  from the saved state.
- `npm test`, `npm run check`, and `npm run build`.
