# Redesign minimap and its separate large overview

**Area:** app, render · **Focus:** in-game UI redesign · **Priority:** P2

**Blocked by:** [02-hud-shell](ingame-ui-02-hud-shell.md)

`hud/minimap/` owns the lower-left map; the reference requires a separate large overview entry and object filters. The wireframe map is decorative, not this implementation.

Follow the [approved design and panel workflow](../../design/ingame-menu/README.md) and
[shared-worktree instructions](../../design/ingame-menu/AGENTS.md). Re-check the cited paths
against this checkout before starting; the reference document describes an earlier implementation.

## Scope

- Design minimap chrome that anchors the bottom of the frameless message rail, with clear large-map access, viewport indicator, pan, zoom and compact filters.
- Design the large overview separately, preserving object categories described in the original reference, known-terrain rules and selected/event markers.
- Inspect actual map/projection/picking capabilities before connecting each action. Do not reveal unexplored objects or replace simulation coordinate conversions with UI guesses.
- Match the accepted style and coordinate window placement with central panels and bottom-right selection. Keep existing performance work in its owner ticket unless directly resolved.

## Verify

Test camera movement/drag/zoom, viewport bounds, map filters, fog, selected/event markers, high-DPI and UI scales. Review on a real map with busy notifications.

For player-visible work, provide the verified preview from this worktree. A mockup is design evidence,
not proof of runtime behavior. Apply the shared design-review step before implementation.
