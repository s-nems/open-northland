# Redesign in-game settings and save/load surfaces

**Area:** app, desktop · **Focus:** in-game UI redesign · **Priority:** P2

`view/system-menu.ts` and `view/save-panels/` own settings/save flow separately from the old toolbar; their visual language must match the redesigned game HUD.

Follow the [approved design and panel workflow](../../design/ingame-menu/README.md) and
[shared-worktree instructions](../../design/ingame-menu/AGENTS.md). Re-check the cited paths
against this checkout before starting; the reference document describes an earlier implementation.

## Scope

- Design system actions, control/graphics/audio settings, save/load lists and confirmations using shared components.
- Preserve settings, restart/quit, regular/quick/automatic saves and supported modern equivalents of historical options. Keep pause behavior explicit and session-safe.
- Coordinate with existing docs/tickets/features/save-quick-keys.md and save-progress-guards.md: those own missing quick-save/autosave/unload mechanics. Do not create duplicate implementations; update dependencies after inspecting their actual status.
- Review docs/tickets/app/quit-to-menu-keeps-fullscreen.md before touching navigation teardown. Scope this ticket to coherent UI and integration of supported save capabilities; do not label missing underlying features complete.

## Verify

Exercise both save stores where supported, confirmation cancel, failure feedback, settings persistence, pause restoration and session exit. Review normal, empty and failed-save states.

For player-visible work, provide the verified preview from this worktree. A mockup is design evidence,
not proof of runtime behavior. Apply the shared design-review step before implementation.
