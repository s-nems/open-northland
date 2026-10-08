# Stop engaged fighters flooding the map with failed grind searches at a holding enemy line

**Area:** sim · **Focus:** conflict chase, movement routing · **Priority:** P2

Fighters engaged against a closed enemy line that holds keep asking for routes to contact nodes
between or behind the enemy ranks. Such a grind ask often starts on a post node, which skips the
`GroupReachability` refusal in `drainPathRequests`. Each failed A* then explores the whole start
region, and this repeats tick after tick.

Measured with a closed two-rank enemy line of 256 unkillable men facing 600 armed attackers on a
51,200-node synthetic map, 1500 ticks:

- Fighters already standing at the line with no order: 63.0M expansions, every tick above 10k
  expansions, about 24 ms of pathfinding per tick.
- The same line approached by an attack-move: 62.5M expansions, 686 ticks above 10k, about 16-17 ms
  per tick.

A failed flood on a real 200k-node map costs about 4x the synthetic map's. The cost scales with the
fighters stuck at the line times the region size, not with active work (root contract rule 6).

## Scope

- Bound the repeated failed searches of an engaged fighter toward contact nodes that bodies seal off:
  share the sealed-region verdict across chasers whose start is a post node, or rest the ask after a
  failure the way an attack-move's `blockedUntil` does. Simply gating attack-move retries off engaged
  fighters made it worse (145M expansions), so the fix belongs in the chase.
- Keep the chase contract: a seal of standing bodies is re-asked at the cadence and never given up;
  a gap that opens is still taken at the next cadence.

## Verify

- The holding-line scenario above, before and after: total expansions, ticks above 10k, pathfinding
  ms per tick on an idle machine.
- `packages/sim/test/conflict/melee-engagement/sealed-target.cases.ts` (the body-seal cadence test)
  and `packages/sim/test/movement/army-routing.test.ts` keep passing.
