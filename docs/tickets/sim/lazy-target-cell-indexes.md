# Build the per-tick `InteractionCellIndex`es lazily

**Area:** sim · **Origin:** carried from the retired `nearest-by-cell-combinator` ticket, 2026-07-15 · **Priority:** P3
(perf — no behavior change)

## Context

`collectTargets` (`packages/sim/src/systems/agents/targets/candidates.ts`) builds three
`InteractionCellIndex`es eagerly every tick — `stockpileCells`, `buildingCells`,
`constructionSiteCells` — even when no settler queries them. Each build is O(candidates) (bounded by
the map, not settlers²), so it is within the RTS budget; this is a latent-cost trim, not a hot-path
fix. Now that every economy nearest-X scan routes through these indexes, a tick with no querying
settler still pays all three constructions.

## Scope

- Make each index a lazy per-tick memo on `TargetCandidates` (the shape `FarmClaims.sowScan` uses:
  a nullable field built by the first caller, reused by the rest), so a tick that never asks for a
  nearest store / building / site never constructs its index.
- Keep the candidate *lists* (`stockpiles`, `buildings`, `constructionSites`) eager — other code
  reads them directly; only the index wrapper is deferred.
- Preserve the `(distance, cell-id, entity-id)` winner exactly — this is a build-timing change only,
  never a pick change.

## Verify

- `npm test` — goldens byte-identical (a moved golden means the pick changed, not just its timing);
  `check`, `build`.
- Optional: a throwaway `dist/` profiling script confirming the idle-tick index builds are elided.

## Source basis

Pure internal perf refactor — no mechanic, extraction, or visual claim.
