# Design and implement the separate large map overview

**Area:** app, render · **Focus:** in-game UI redesign · **Priority:** P2

The compact minimap (`hud/minimap/`) is done: three frames, S/M/L/XL sizes, zoom, camera picking,
middle-drag pan, layer, owner, ground, marker size and colour filters, and the relief raster
(`rasterizeMinimap` in render). The large overview is missing. In the original a globe button beside
the minimap opens it, with its own filters for inhabitants, soldiers, animals, vehicles, buildings,
signposts, stockades, roads, terrain, sheep, cows and chests.

## Scope

- Design the large map's frame and get it approved, then open it from the minimap. Follow the HUD
  panel rules in `packages/app/AGENTS.md`.
- Show only categories and markers the snapshot and projections actually provide.
- Keep known-terrain rules, fog gates and order coordinate conversion.
- Keep the large view's state apart from the compact minimap's size and the world camera.

## Verify

Test opening, closing and focus return, camera moves and orders, zoom and pan bounds, filters, fog and
markers. Check real maps, high-DPI and UI scales with notifications and a selection open, and provide
the verified preview.
