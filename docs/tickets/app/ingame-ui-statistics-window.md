# Implement the statistics charts and lists

**Area:** app · **Focus:** in-game UI redesign · **Priority:** P2

**Blocked by:** [statistics-data](ingame-ui-statistics-data.md)

The diagnostic stats popup (`hud/tool-panel/stats-window.ts`) cannot answer the player's economic
questions. The data ticket supplies the series contract and the reviewed view definitions.

## Scope

- Design the chart and list layouts and get them approved before implementing them. Follow the HUD
  panel rules in `packages/app/AGENTS.md`.
- Provide People, Professions, Buildings, Building List, Goods, Miscellaneous and Cemetery with
  toggleable series, each entry's colour matching its line and its current value beside it, and 1, 2,
  5 and 10-hour ranges.
- Label colours so nothing is identified by colour alone; distinguish no data, no population and empty
  history.
- Keep diagnostics in the diagnostic tools, out of the player window. Persist chart and filter choices
  consistently with the save and UI settings.

## Verify

Test series and range selection, sparse history, long sessions, names and units; inspect the charts
at supported UI scales and confirm plotted values against controlled data. Provide the verified
preview.
