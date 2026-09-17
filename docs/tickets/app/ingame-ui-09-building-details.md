# Redesign the selected building panel

**Area:** app · **Focus:** in-game UI redesign · **Priority:** P2

**Blocked by:** [08-settler-details](ingame-ui-08-settler-details.md)

`hud/details-panel/sections/building/` has distinct stock, production, worker, defence and construction views whose functions need a coherent replacement.

Follow the [approved design and panel workflow](../../design/ingame-menu/README.md) and
[shared-worktree instructions](../../design/ingame-menu/AGENTS.md). Re-check the cited paths
against this checkout before starting; the reference document describes an earlier implementation.

## Scope

- Design building families and states: construction site, home, production, warehouse, military and special buildings. Show a representative full panel before implementation.
- Preserve workforce assignment, production selection, inventory/stock controls, construction materials and supported special actions. Keep costs, supplies and output meanings explicit.
- Reuse accepted resident-panel chrome, resource icons and shared interaction patterns; do not create another visual family.
- Verify the existing original-building-names, tribe-partition and husbandry-player-feedback tickets before touching overlapping presentation. Preserve source basis and update only completed overlap.

## Verify

Test model/action paths for each supported family, construction progression, empty/full stock and foreign ownership. Inspect long names and all relevant sections without minimap/menu overlap.

For player-visible work, provide the verified preview from this worktree. A mockup is design evidence,
not proof of runtime behavior. Apply the shared design-review step before implementation.
