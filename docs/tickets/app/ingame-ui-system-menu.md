# Redesign in-game settings and save/load surfaces

**Area:** app, desktop · **Focus:** in-game UI redesign · **Priority:** P2

`view/system-menu.ts` and `view/save-panels/` own settings and saves in a visual language that does
not match the DOM HUD. The original's options window covers quit and restart, interface, video and
audio settings, and load and save with regular, quick and automatic saves.

## Scope

- Design system actions, control, graphics and audio settings, save and load lists and confirmations
  from the shared HUD components. Follow the HUD panel rules in `packages/app/AGENTS.md`.
- Keep settings, restart and quit, and the supported saves. Map historical hardware options to modern
  equivalents only where they mean something. Keep pause behavior explicit and session-safe.
- `docs/tickets/features/save-quick-keys.md` and `save-progress-guards.md` own the missing quick-save,
  autosave and unload mechanics; integrate what exists without duplicating them.
- Read `docs/tickets/app/quit-to-menu-keeps-fullscreen.md` before touching navigation teardown.

## Verify

Exercise both save stores where supported, cancelled confirmations, failure feedback, settings
persistence, pause restoration and session exit. Review normal, empty and failed-save states and
provide the verified preview.
