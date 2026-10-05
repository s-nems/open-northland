# Verify the complete redesigned HUD and retire obsolete UI

**Area:** app · **Focus:** in-game UI redesign · **Priority:** P2

**Blocked by:** [group-details](ingame-ui-group-details.md),
[statistics-window](ingame-ui-statistics-window.md),
[knowledge-dependencies](ingame-ui-knowledge-dependencies.md), [system-menu](ingame-ui-system-menu.md),
[map-overview](ingame-ui-map-overview.md)

Panels landed one at a time; one end-to-end pass has to catch inconsistent styles, remaining functional
gaps and obsolete routes.

## Scope

- Map every original menu-bar function (construction and papers, assistant, mission, diplomacy,
  statistics, subjects, technology tree, options with save and load, help, game speed, message
  priority, minimap and large map) to its new destination, and list the exact remaining blockers.
  Disabled placeholders are not complete functionality.
- Review all panels together for style, density, icons, labels, focus, tooltip placement and
  open/close rules. Remove dead legacy toolbar and help paths once replacements cover them, including
  `hud/tool-panel/pending-window.ts`.
- Play an economy across construction, needs, residents, assistant, statistics, missions, diplomacy
  and Knowledge with notifications and a selection open at once.
- Verify supported window sizes and UI scales, Polish and English text, ownership and spectator
  restrictions, pause and speed, saves and multiplayer command boundaries.

## Verify

Run the applicable gates from `docs/TESTING.md` and the final review `AGENTS.md` requires. Report the
functional and visual evidence and missing checks, and get the owner's visual acceptance of the real
game from a verified preview.
