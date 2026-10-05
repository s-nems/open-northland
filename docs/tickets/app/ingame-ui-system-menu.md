# Redesign in-game save and load surfaces

**Area:** app, desktop · **Focus:** in-game UI redesign · **Priority:** P2

The Esc menu and live settings use the DOM HUD family in `hud/dom/system-menu.ts` and
`hud/dom/system-settings.ts`. Save and load still use the older lists and inline styling in
`view/save-panels/`; their overwrite, delete and load confirmations use `view/confirm-dialog.ts`.

## Scope

- Bring save and load lists, empty/error states and their confirmations into the shared HUD family.
  Follow the HUD panel rules in `packages/app/AGENTS.md`.
- Preserve the menu's pause ownership and back/focus behavior, both save stores, file import/export,
  overwrite and delete, and the multiplayer load restriction.
- `docs/tickets/features/save-quick-keys.md` and `save-progress-guards.md` own the missing quick-save,
  autosave and unload mechanics; integrate what exists without duplicating them.

## Verify

Exercise both save stores where supported, cancelled confirmations, failure feedback, pause
restoration and keyboard navigation. Review normal, empty and failed-save states and provide the
verified preview.
