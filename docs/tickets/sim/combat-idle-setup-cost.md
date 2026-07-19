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
- **Building-tail scan** (added by the attack-enemy-buildings review, 2026-07-19):
  `combatPossible`'s tail (`systems/conflict/combat.ts` — the `owners.size >= 1` block) now walks
  **every** `Health`-bearing building each tick it reaches, on any map with an owned unit and no
  other combat trigger (a single-player base: all buildings own-owned → no early exit, the whole
  building set scanned every peaceful tick). Bounded O(buildings) and correct, but a cached
  distinct-building-owner count (rebuilt on building placement/destruction) would restore the flat
  cost. Cheap today (buildings ≪ units); revisit if a big single-player base shows up in the bench.
- While in there: `engageCombatant` is at 7 positional params over three parallel per-tick
  structures — a small per-tick bundle (`{terrain, index, presence, slots}`) would tighten the
  signatures (review note from the presence-gate change).

Keep winners canonical and goldens byte-identical — this is elide-provably-empty-work only.

## Verify

`npm test` (goldens unmoved), `npm run check`, `npm run build`; a before/after per-tick bench on a
fighter-heavy world (`ON_BENCH_FIGHTERS=200 npm run bench:sim` — note a fighter run is
non-stationary, so compare like-for-like windows).
