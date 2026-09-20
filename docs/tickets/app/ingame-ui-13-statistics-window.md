# Implement the designed statistics charts and lists

**Area:** app · **Focus:** in-game UI redesign · **Priority:** P2

**Blocked by:** [12-statistics-data](ingame-ui-12-statistics-data.md)

The diagnostic stats popup cannot answer the player's economic questions. Ticket 12 supplies the real series contract and initial reviewed view definitions.

Follow the [approved design and panel workflow](../../design/ingame-menu/README.md) and
[session instructions](../../design/ingame-menu/AGENTS.md). Re-check the cited paths
against this checkout before starting; the reference document describes an earlier implementation.

## Scope

- Refine and approve chart/list layouts in the common visual language before implementation.
- Provide People, Professions, Buildings, Building List, Goods, Miscellaneous and Cemetery information with readable series controls, current values and 1/2/5/10-hour ranges.
- Make colours accessible with labels and avoid colour-only identification; distinguish no data, no population and empty history.
- Keep diagnostics in the diagnostic tools, not the player statistics window. Preserve useful chart/filter preferences consistently with save/UI policy.

## Verify

Test series/range selection, sparse history, long sessions, names and units; inspect charts at supported UI scales and confirm plotted values against controlled data.

For player-visible work, provide the verified preview from the ticket's worktree. A mockup is design evidence,
not proof of runtime behavior. Apply the shared design-review step before implementation.
