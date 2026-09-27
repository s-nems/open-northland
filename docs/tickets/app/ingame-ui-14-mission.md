# Redesign mission briefing, objectives and history

**Area:** app · **Focus:** in-game UI redesign · **Priority:** P2

`hud/tool-panel/mission/` already contains briefing/history surfaces; the old menu path forces pause although the checked original path did not establish that behavior.

Follow the [approved design and panel workflow](../../design/ingame-menu/README.md) and
[session instructions](../../design/ingame-menu/AGENTS.md). Re-check the cited paths
against this checkout before starting; the reference document describes an earlier implementation.

## Design review

The owner chose the book (`docs/design/ingame-menu/mission.html`, served by `serve.mjs` with the local
review directory, `packages/app/src` and `packages/app/public`); its page data, world captures and
generated cover art live only in the local review directory under `mission-review/`. The mockup
settles these rules:

- Only what the map provides: page text, its pictures, its world views and its goals. No narration,
  and no invented title for a page without one.
- Pictures and world views stay inside the text where the page places them; the text flows across both
  pages instead of scrolling.
- Goals list only revealed ones, without a total or progress count.
- On the map, a goal slip hangs under the summary bar and folds to a tab that opens and closes it.

Open with the owner: whether visible but inactive goals print dimmed (today's reading of the original)
or stay hidden (the mockup), and the final picture placement (the mockup offers both). The cover art is
delivered with its provenance before implementation.

## Scope

- Build Task/Briefing, Objectives and History as the book, including illustrations, world views, long text, completed goals and mission updates, plus the goal slip on the map.
- Open Misja directly and distinguish voluntarily opened information from scripted briefing transitions. Reading must not silently alter pause; preserve existing script semantics unless separately verified.
- Retain prior briefing navigation and saved mission history.
- Use own UI assets and retain the project's legal boundary for original content; do not commit original captures as design references.

## Verify

Test active/completed goals, long history, the slip's fold state, reopen, save/load and single/multiplayer pause behavior. Review a real scripted mission.

For player-visible work, provide the verified preview from the ticket's worktree. A mockup is design evidence,
not proof of runtime behavior. Apply the shared design-review step before implementation.
