# Create the direct assistant window

**Area:** app · **Focus:** in-game UI redesign · **Priority:** P2

**Blocked by:** [02-hud-shell](ingame-ui-02-hud-shell.md)

`hud/tool-panel/extras-window.ts`, `extras-menu.ts`, and `view/assistant-counters.ts` expose Assistant inside the old Extras window with approximate layout.

Follow the [approved design and panel workflow](../../design/ingame-menu/README.md) and
[shared-worktree instructions](../../design/ingame-menu/AGENTS.md). Re-check the cited paths
against this checkout before starting; the reference document describes an earlier implementation.

## Scope

- Design automation settings with clear targets, current values, enable/disable controls, limits and explanation of individual-order precedence.
- Open Asystent directly. Preserve population, soldier/weapon-class and equipment automation through existing session commands; remove Documents from this surface.
- Verify counter/limit and infinity behavior against available evidence before assuming parity. Distinguish an approximation from a changed UX rule.
- Use consistent numeric steppers, feedback and tooltips from the accepted design; do not change automation policy merely to simplify the UI.

## Verify

Test limits, repeated input, disabled/unsupported settings, owner isolation and multiplayer command submission. Compare controls with actual assistant state and inspect empty/small/large settlements.

For player-visible work, provide the verified preview from this worktree. A mockup is design evidence,
not proof of runtime behavior. Apply the shared design-review step before implementation.
