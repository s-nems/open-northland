# Design and implement the direct construction window

**Area:** app, data · **Focus:** in-game UI redesign · **Priority:** P2

`hud/tool-panel/building-menu.ts` currently exposes only part of the construction scope recorded in ORIGINAL-INGAME-MENU-BAR.md.

Follow the [approved design and panel workflow](../../design/ingame-menu/README.md) and
[shared-worktree instructions](../../design/ingame-menu/AGENTS.md). Re-check the cited paths
against this checkout before starting; the reference document describes an earlier implementation.

## Scope

- Design the detailed catalog, category filters, building cards/rows, costs, requirements, help links, unavailable and placement states; obtain panel approval before implementation.
- Open the catalog directly from Buduj/B. Put roads, stockades and gates inside it, plus one Documents entry. No construction submenu on the HUD.
- Preserve map-specific availability, affordability and current placement validation. After choosing an item, expose the map for placement; cancel and return without losing the intended catalog state.
- Inspect actual path/wall/gate commands and docs/tickets/features/map-scripts-wall-gates.md. Implement presentation against verified capabilities; do not claim blocked mechanics work or duplicate the separate simulation task.
- Provide contextual building description and requirements destinations for Knowledge. Coordinate the Documents entry with ticket 06.

## Verify

Verify available/unavailable buildings, costs, insufficient goods, wrong-owner/spectator restrictions, each construction mode, cancellation and camera interaction. Use focused controller/placement tests and a real map.

For player-visible work, provide the verified preview from this worktree. A mockup is design evidence,
not proof of runtime behavior. Apply the shared design-review step before implementation.
