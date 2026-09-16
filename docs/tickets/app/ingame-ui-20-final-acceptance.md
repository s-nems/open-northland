# Verify the complete redesigned HUD and retire obsolete UI

**Area:** app · **Focus:** in-game UI redesign · **Priority:** P2

**Blocked by:** [03-notifications](ingame-ui-03-notifications.md), [04-summary-and-clock](ingame-ui-04-summary-and-clock.md), [06-documents](ingame-ui-06-documents.md), [07-residents](ingame-ui-07-residents.md), [10-group-details](ingame-ui-10-group-details.md), [11-assistant](ingame-ui-11-assistant.md), [13-statistics-window](ingame-ui-13-statistics-window.md), [14-mission](ingame-ui-14-mission.md), [15-diplomacy](ingame-ui-15-diplomacy.md), [17-knowledge-dependencies](ingame-ui-17-knowledge-dependencies.md), [18-system-menu](ingame-ui-18-system-menu.md), [19-map-overview](ingame-ui-19-map-overview.md)

Panel-by-panel implementation needs one end-to-end acceptance pass to expose inconsistent styles, remaining functional gaps and obsolete routes before integration.

Follow the [approved design and panel workflow](../../design/ingame-menu/README.md) and
[shared-worktree instructions](../../design/ingame-menu/AGENTS.md). Re-check the cited paths
against this checkout before starting; the reference document describes an earlier implementation.

## Scope

- Reconcile every action in ORIGINAL-INGAME-MENU-BAR.md with its real new destination, including save/automation/papers/map functions. List exact remaining blockers; mocks or disabled placeholders are not complete functionality.
- Review all panels together for shared style, density, icon treatment, labels, focus, tooltip placement and open/close rules. Remove dead legacy toolbar/help-admin paths only after replacements cover their player functions.
- Exercise economical play across construction, needs, inhabitants, assistant, statistics, missions, diplomacy and Knowledge with notifications and selection simultaneously.
- Verify supported window sizes/UI scales, Polish/English text, ownership/spectator restrictions, pause/speed, saves and multiplayer command boundaries.
- Prepare the concrete branch diff and verified game preview for user acceptance. The shared-worktree instruction does not authorize automatic merge or removal; integrate only on explicit instruction, following linear history.

## Verify

Run relevant complete gates from docs/TESTING.md, asset/docs checks and the final review required by AGENTS.md. Report actual functional/visual evidence and missing checks; get user visual acceptance of the real game.

For player-visible work, provide the verified preview from this worktree. A mockup is design evidence,
not proof of runtime behavior. Apply the shared design-review step before implementation.
