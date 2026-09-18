# Provide the real historical data required by statistics

**Area:** app, sim · **Focus:** in-game UI redesign · **Priority:** P2

`hud/tool-panel/stats-window.ts` exposes diagnostic summaries rather than the original historical series and building lists.

Follow the [approved design and panel workflow](../../design/ingame-menu/README.md) and
[shared-worktree instructions](../../design/ingame-menu/AGENTS.md). Re-check the cited paths
against this checkout before starting; the reference document describes an earlier implementation.

## Scope

- Before data implementation, draft and obtain review of the intended statistics views/series and their definitions so collection serves a concrete panel.
- Inspect existing sim/session/save data. Define population, professions, buildings, goods/food production, marriages/births/deaths and deceased-hero history from verified events rather than current-stock differences.
- Implement the minimum bounded collection/projection contract for those views, with simulation-time ranges and deterministic save semantics where state is persisted.
- Name any unavailable source or missing mechanic; keep actual zero distinct from uncollected history. Follow persisted-format replacement/version rules, not migrations.
- Do not build the final charts here; expose a concrete consumer contract for ticket 13.

## Verify

Test known event sequences, sampling boundaries, x1/x3 equivalent sim-time results, retention bounds, owner separation and save/load. Verify production is not confused with stock.

For player-visible work, provide the verified preview from this worktree. A mockup is design evidence,
not proof of runtime behavior. Apply the shared design-review step before implementation.
