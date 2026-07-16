# Cut the combat system's idle per-fighter scan cost

**Area:** sim · **Origin:** forteca diagnostics-bundle profile, fix/regression-fixes 2026-07-16 · **Priority:** P2

Profiling a real `specjalna_forteca` session (227 settlers, 168 of them fighter-band jobs, no battle
at all) shows `combatSystem`/`engageCombatant` burning a flat ~5–6 ms/tick — over half the ~10 ms
whole-sim baseline — every tick the map merely has two players. V8 self-time hotspots inside it:
`engageCombatant`, `generalAccept`/`isValidTarget` (per-fighter threat scans), plus
`dynamicBlockedCells` and `staggerShift` further down. At ×3 speed this is ~18 ms/frame spent proving
peaceful fighters have nothing to do; per the RTS-scale budget, per-tick cost must scale with active
work, not the standing army size.

## Scope

Profile-first, then a dormancy/staging gate: likely candidates are widening the threat-scan cadence
for units with no known enemy in range (rescan every N ticks with a spatial early-out, the pattern
the needs/idle systems use), or gating `engageCombatant` on a per-region enemy-proximity index
instead of per-fighter scans. Keep canonical winners byte-identical — a cadence change is
behavioral, so it must be intentional and named if goldens move.

## Verify

`npm test` (goldens move only if the cadence change is intentional and named), plus a before/after
per-system profile on a fighter-heavy world (the throwaway dist-profiling script pattern from
`packages/sim/AGENTS.md`).
