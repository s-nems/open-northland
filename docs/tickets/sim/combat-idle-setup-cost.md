# Cut the combat system's residual per-tick setup cost on awake peaceful maps

**Area:** sim · **Origin:** combat-idle-scan-cost execution, 2026-07-17 · **Priority:** P3
(perf — no behavior change; canonical winners must stay byte-identical)

The HostilePresence early-out (`systems/conflict/presence.ts`, commit "perf: Skip idle combat ring
scans via a coarse hostile-presence grid")
removed the per-fighter ring searches on peaceful two-player maps (synthetic 239-combatant bench:
~10.8 ms → ~0.44 ms per combat tick). The residual cost is the awake-tick setup that still runs
every tick whenever `combatPossible` passes (any two-player map): the `combatPossible` scan itself
(per-combatant component reads + content lookups), `canonicalById` (an O(c log c) sort of all
combatants), the `NodeBuckets` build, the `HostilePresence` build, and per-fighter fixed work in
`engageCombatant` (weapon resolution, `engageSpec` closure allocation). All O(combatants) per tick
— fine at ~250 units, a few ms at the "thousands of units" doctrine scale.

Candidates (profile before picking):

- Build `NodeBuckets` lazily — it is only consulted after a presence-gate hit, so a fully calm
  tick could skip the bucket build (the presence grid alone answers the calm case).
- Hoist the per-fighter `engageSpec` closure allocations out of the calm path (the early-out fires
  inside `resolveTarget`, after the spec object is built).
- Memoize or cheapen the `combatPossible` classification reads.
- While in there: `engageCombatant` is at 7 positional params over three parallel per-tick
  structures — a small per-tick bundle (`{terrain, index, presence, slots}`) would tighten the
  signatures (review note from the presence-gate change).

Keep winners canonical and goldens byte-identical — this is elide-provably-empty-work only.

## Verify

`npm test` (goldens unmoved), `npm run check`, `npm run build`; a before/after per-tick bench on a
fighter-heavy peaceful world (throwaway script or the harness from
docs/tickets/sim/perf-benchmark-harness.md).
