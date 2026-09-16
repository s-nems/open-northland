# Add tribe counters, grouped resources and simulation time

**Area:** app · **Focus:** in-game UI redesign · **Priority:** P2

**Blocked by:** [02-hud-shell](ingame-ui-02-hud-shell.md)

The approved top-right summary is not wired to gameplay; values in index.html are examples. Population ownership, resource counting and clock semantics must come from real session data.

Follow the [approved design and panel workflow](../../design/ingame-menu/README.md) and
[shared-worktree instructions](../../design/ingame-menu/AGENTS.md). Re-check the cited paths
against this checkout before starting; the reference document describes an earlier implementation.

## Scope

- Design compact counters and hover/focus resource breakdowns to the left of time/speed controls. Count the local player's whole tribe across the map, not camera-visible entities; adults and children are disjoint.
- Show Food, Materials, Armament, Equipment and Other with localized per-good quantities. Propose and confirm the inventory scope explicitly (wireframe proposes warehouses); never silently combine incompatible stock scopes or invent economic totals.
- Derive category membership from verified catalog/content bindings. Keep tooltip open while moving into it, handle long lists, zero counts and keyboard focus; do not hide essential information behind icons alone.
- Show elapsed simulation time: one second per real second at x1, three at x3, no advance while paused. Use session simulation time so saves, loads and multiplayer stay consistent; do not use the wireframe's browser timer.
- Reuse maintained snapshots/projections and avoid per-frame whole-world scans.

## Verify

Use mixed-owner snapshots, children, off-screen residents, multiple stock locations and goods categories. Verify x1/x2/x3, pause and save/load; inspect tooltips at supported sizes.

For player-visible work, provide the verified preview from this worktree. A mockup is design evidence,
not proof of runtime behavior. Apply the shared design-review step before implementation.
