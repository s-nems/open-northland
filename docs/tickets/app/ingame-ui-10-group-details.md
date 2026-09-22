# Redesign multiple-selection details and shared orders

**Area:** app · **Focus:** in-game UI redesign · **Priority:** P2

**Blocked by:** [08-settler-details](ingame-ui-08-settler-details.md), [09-building-details](ingame-ui-09-building-details.md)

`hud/details-panel/selection-view.ts` and `view/unit-controls/` own selection behavior; the wireframe's eight-person grid is only a spatial example.

Follow the [approved design and panel workflow](../../design/ingame-menu/README.md) and
[session instructions](../../design/ingame-menu/AGENTS.md). Re-check the cited paths
against this checkout before starting; the reference document describes an earlier implementation.

## Scope

- Design small, large and mixed selections with bounded panel size, distinguishable portraits/counts and accessible per-person inspection.
- Show only commands valid for the selection; explain partial applicability and forbidden orders rather than silently issuing misleading commands. The action ring already shows a group order when any member allows it and sends it only to those members (`orderRecipients` in `view/unit-controls/action-ring/menu-state.ts`); the panel should show which members an order will reach.
- Preserve selection identity while members die, disappear or become ineligible; keep camera controls and interaction with the residents list consistent.
- Use the same bottom-right component family as single-entity details, with scrolling or pagination rather than an indefinitely growing panel.

## Verify

Test single-to-multiple transitions, mixed professions/owners, large groups, select-one-from-group and live removals. Review orders and camera behavior, not just the grid.

For player-visible work, provide the verified preview from the ticket's worktree. A mockup is design evidence,
not proof of runtime behavior. Apply the shared design-review step before implementation.
