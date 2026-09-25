# Finish the settler panel's deferred affordances

**Area:** app, sim · **Focus:** in-game UI redesign · **Priority:** P3

**Blocked by:** [16-knowledge-reference](ingame-ui-16-knowledge-reference.md) for the lock link

The DOM settler panel (`packages/app/src/hud/dom/settler-panel/`) ships every section of the
"Settler panel" spec in [FOUNDATION.md](../../design/ingame-menu/FOUNDATION.md) except two
affordances whose data or target does not exist yet. The spec names each gap where it applies.

## Scope

- **Knowledge link.** The lock on a locked product calls `SettlerPanelActions.openKnowledge`, which
  `view/unit-controls/settler-panel.ts` leaves unwired. Wire it to the good's Knowledge entry once
  ticket 16 provides one.
- **Wear minutes.** A worn item's socket tooltip gives the life left as a percent only. The spec's
  "minutes it buys at the current pace" needs a sim read seam for the wear an item takes per game
  minute of its wearer's current work; add it only if it is cheap for the one selected settler.

## Verify

Unit-test the Knowledge link opening the right entry and the wear estimate against a known pace.
Check a locked product and a worn tool in the running game.

For player-visible work, provide the verified preview from the ticket's worktree.
