# Provide the real historical data required by statistics

**Area:** app, sim · **Focus:** in-game UI redesign · **Priority:** P2

`hud/tool-panel/stats-window.ts` shows diagnostic summaries, not historical series. The original's
statistics have People, Professions, Buildings, Building List (sites in parentheses), Goods
(production history, food included), Miscellaneous (marriages, births, deaths) and Cemetery
(deceased heroes), over 1, 2, 5 or 10 hours of game time, persisted in saves.

## Scope

- Before collecting data, get the intended views and their series definitions reviewed, so collection
  serves a concrete window.
- Inspect existing sim, session and save data. Define each series from verified events, not from
  differences in current stock.
- Implement the minimum bounded collection and projection for those views, with simulation-time
  ranges and deterministic save semantics. Follow the persisted-format rules in the root `AGENTS.md`.
- Name any unavailable source or missing mechanic; keep a real zero distinct from uncollected history.
- Do not build the charts here; expose a consumer contract for
  [statistics-window](ingame-ui-statistics-window.md).

## Verify

Test known event sequences, sampling boundaries, equal sim-time results at x1 and x3, retention
bounds, owner separation and save/load. Check that production is not confused with stock.
