# Profile and cut the dynamicBlockedCells / staggerShift hotspots

**Area:** sim · **Origin:** forteca diagnostics-bundle profile, fix/regression-fixes 2026-07-16
(carried out of docs/tickets/sim/combat-idle-scan-cost.md, whose combat share is done) · **Priority:** P3

The `specjalna_forteca` profile (227 settlers, no battle) that exposed the combat idle scans also
showed `dynamicBlockedCells` and `staggerShift` as V8 self-time hotspots further down the listing.
The combat share was fixed (HostilePresence early-out); these two were out of that ticket's scope
and their per-tick cost is unmeasured in isolation.

Investigate-first:

- `dynamicBlockedCells` (`systems/footprint/blocked.ts`) is called independently by several systems
  each tick — routing (`movement/routing.ts`), separation (`movement/collision/separation.ts`),
  destack (`agents/destack.ts`), family wander (`family/wander.ts`), farming targets
  (`agents/farming/targets.ts`) — each behind its own `??=` per-call cache. Since 2026-07-18 both
  inputs are cached (`building-blocked-cache.ts` memo + the incremental resource cache), so each call
  now pays only the UNION COPY into a fresh `Set`, not a Building-store rescan — re-profile before
  cutting further; if the copy still shows, one shared per-tick union set (or switching the pure
  membership consumers to `dynamicBlockOverlay`'s copy-free view) is the remaining lever.
- `staggerShift` (`nav/metric.ts`) is a leaf of every position↔node conversion
  (`nodeOfPosition`), so its self-time may just be call volume — measure who the top callers are
  before optimizing anything.

Determinism: overlays are derived state; any sharing must keep contents identical so winners and
goldens stay byte-identical.

## Verify

Per-system before/after profile on the same fighter-heavy world (throwaway dist script per
`packages/sim/AGENTS.md`); `npm test` with goldens unmoved, `npm run check`, `npm run build`.
