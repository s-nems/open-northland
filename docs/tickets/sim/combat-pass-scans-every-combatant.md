# Keep the combat index and its candidate set across ticks instead of rebuilding them from every combatant

**Area:** sim · **Focus:** conflict · **Priority:** P2

Once two owners exist, `combatSystem` (`systems/conflict/combat.ts`) passes the dormancy gate every tick
and then works from every combatant: it takes the canonical `Settler, Health, Position` join, builds a
fresh `CombatIndex` over it, and asks `mayEngage` (`conflict/acting.ts`) of each one. Only the units
that may act run the ladder, but the gate itself is a per-tick pass over every settler and animal, a
rule-6 violation (`AGENTS.md`). Each acting unit then builds its `engageSpec`
(`conflict/engagement.ts`): about ten closures and spec objects per unit per tick.

Measured on `krwawa_rzeka`, 12 AI seats, t100k (`docs/perf/heavy-load-krwawa-rzeka-12ai.md`): combat
is 2.0 ms a tick on a quiet box; the index build 0.36 ms; `mayEngage` runs over 1685 combatants for
about 0.7 ms and admits 385 (135 garrison, 111 with a stranger within reach, 39 engaged, 60 fleeing, 32
on attack-move orders); the rejects are 821 with nobody near, 252 passive animals, 120 travelling and
107 held by an atomic. Profile share at t100k: `combatSystem` self 2.5%, `mayEngage` 2.5%,
`CombatIndex` 2.0%, the join 0.6%. `engageSpec` allocates 166 KB a tick. In the live worker profile at
82k, `answerQueuedAlarms` alone is 6.9%.

## Scope

- The `CombatIndex` is kept across ticks from the Position and membership change feeds instead of
  rebuilt; its query answers and tie-breaks stay the same.
- A kept candidate set replaces the pass over every combatant: holders of ladder state, orders,
  garrisons, hunters and aggressive animals, plus units whose coarse cell neighbourhood holds a
  foreign owner (per-cell owner counts updated per move). Passive animals and plain walkers never enter
  it.
- Measure `answerQueuedAlarms` at the same checkpoint and bound it if it is a pass over every alarm
  each tick.
- `engageSpec` builds its closures only on the rungs that search, or one reusable spec per pass reads
  its fields.
- Hash-identical: the same units act in the same order.

## Verify

- State hash unchanged over 2000 ticks from the reference's t80k and t100k checkpoints; the conflict
  tests and goldens unchanged.
- Combat mean per tick and its growth over the 100k run fall; `engageSpec` KB per tick in
  `ON_BENCH_PROFILE=alloc`.
- `npm test`, `npm run check`.
