# Design and implement the separate large map overview

**Area:** app, render · **Focus:** in-game UI redesign · **Priority:** P2

The approved compact Atlas minimap has S/M/L/XL sizes, frame zoom controls, camera picking, middle-drag pan,
people/building filters and a live HUD footprint. The separate large overview is still missing;
its frame has not been selected. The minimap retains the existing terrain rendering.

Follow the [approved design workflow](../../design/ingame-menu/README.md) and
[shared minimap decisions](../../design/ingame-menu/FOUNDATION.md#minimap-direction).
The [minimap reference](../../design/minimap-study/README.md) describes the implemented compact view.
Its approval does not select the large-map frame.

## Scope

- Choose the large-map frame with a reviewable design, then add explicit access from the minimap.
- Connect only categories and selected/event markers supported by actual snapshot/projection data.
- Preserve known-terrain rules, fog gates and order coordinate conversion.
- Keep large-view state separate from compact minimap size and the world camera.
- Keep performance work in its existing owner ticket unless directly resolved.

## Verify

Test open/close and focus return, camera movement and orders, zoom/pan bounds, supported filters,
fog and markers. Check actual maps, high-DPI and UI scales with notifications and selection open.
Provide a verified game preview from the worktree.
