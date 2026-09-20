# Redesign mission briefing, objectives and history

**Area:** app, audio · **Focus:** in-game UI redesign · **Priority:** P2

`hud/tool-panel/mission/` already contains briefing/history surfaces; the old menu path forces pause although the checked original path did not establish that behavior.

Follow the [approved design and panel workflow](../../design/ingame-menu/README.md) and
[session instructions](../../design/ingame-menu/AGENTS.md). Re-check the cited paths
against this checkout before starting; the reference document describes an earlier implementation.

## Scope

- Design Task/Briefing, Objectives and History views, including voice controls, illustrations, long text, completed goals and mission updates.
- Open Misja directly and distinguish voluntarily opened information from scripted briefing transitions. Reading must not silently alter pause; preserve existing script semantics unless separately verified.
- Retain narration, prior briefing navigation and saved mission history. Stop/release owned audio correctly when closing or switching pages.
- Use own UI assets and retain the project's legal boundary for original content; do not commit original captures as design references.

## Verify

Test active/completed goals, long history, narration lifecycle, reopen, save/load and single/multiplayer pause behavior. Review a real scripted mission.

For player-visible work, provide the verified preview from the ticket's worktree. A mockup is design evidence,
not proof of runtime behavior. Apply the shared design-review step before implementation.
