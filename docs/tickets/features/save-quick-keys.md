# Quicksave, quickload, and a key that opens the system menu

**Area:** app · **Focus:** save/load, controls · **Priority:** P2

Saving costs five interactions today: click the tool-panel menu button, click Save game, aim at the name
field, type, press Enter. Nothing on the keyboard opens the menu, and there is no one-key save at all, so
the routine loop a Cultures session runs on is the slowest path in the feature.

## Scope

- Bind a quicksave key that writes a reserved slot without opening a panel, and a quickload key that
  restores that slot through the existing confirm dialog. Both report through the HUD, not a panel status
  line, since no panel is open.
- Bind a key that opens and closes the system menu, matching the Escape step-back the menu already has.
- Take every binding from the stored key bindings, so a player can rebind them like the camera keys.
- The quicksave slot is a normal save file the lists show; nothing may make it invisible or unloadable
  through the panels.

## Verify

- A quicksave then a quickload returns the same world state hash, and the quicksave slot lists like any
  other save on both stores.
- The menu key opens the menu with the pause the button path forces, and closes it releasing the pause.
- Quickload from a different world refuses with the same `wrongWorld` message the panel gives.
- `npm run check`, `npm run build`, `npm test`, plus a browser pass on a real map.
