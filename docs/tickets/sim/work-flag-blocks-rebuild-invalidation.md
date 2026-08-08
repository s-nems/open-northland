# Stop construction progress from rebuilding the work-flag blocked set

**Area:** sim · **Focus:** footprint/placement · **Priority:** P2 · **Complexity:** medium

`workFlagPlacementBlocks` keeps an incremental refcounted blocked set, but `catchUp` treats any
`componentValueGeneration(Building)` bump as "captured cells may have changed" and demands a full
`rebuildState`. `buildingBlockerCells` reads only `buildingType` and `Position`, while
`constructionSystem` writes `Building.built` every tick for every active site, so with six AI seats
the guard is stale on effectively every placement query and the full rebuild is the steady state,
exactly the N × O(all blockers) cost the incremental state exists to avoid. Each rebuild re-captures
every resource footprint; on magiczny_las (36.8k entities, forest) that is tens of thousands of
`resourceBlockerCells` captures and fresh `BlockedCells` arrays per query.

Evidence (rev fb833032, live magiczny_las 6-AI probe, `?debug=profile` + 30 s V8 profiles at tick
~900 and ~23k): the rebuild complex (`rebuildState`, `resourceBlockerCells`, `captureCells`,
`staggerShift`) is 78-88% of the `aiPlayer` subtree, and `aiPlayer` is 45-50% of all sim time
(mean 3.8 -> 5.1 ms/tick, max 41 -> 54 ms single ticks). With six staggered seats an AI-decision
tick lands every ~4th tick, and those ticks are the dominant frame spikes behind the live session's
40-120 FPS oscillation. `signpostOrder` pays the same rebuild (max 32 ms observed).

## Scope

- Invalidate per entity, not per store: on a `Building` value-generation bump, resync only Building
  entities (O(buildings), hundreds) instead of rebuilding every source (O(resources), tens of
  thousands); or record the captured `buildingType` per building and resync only mismatches, so
  `built`/`level` writes cost nothing.
- Keep the registered `verifyCaches` verifier passing: the held set must stay byte-identical to
  `rederiveBlockedCells`.
- Cache work only, no command or decision change; goldens and atomic traces stay byte-identical.

## Verify

- A live `?debug=profile` probe of the same session: `aiPlayer` mean and max drop, and the rebuild
  complex leaves the spike attribution.
- `npm run bench:map` (bounded ticks) before/after on the same box.
- `npm test`, `npm run check`, `npm run build`.
