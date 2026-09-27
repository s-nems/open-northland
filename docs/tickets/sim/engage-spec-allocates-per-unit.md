# Stop the combat ladder building a closure set per acting unit per tick

**Area:** sim · **Focus:** conflict · **Priority:** P3

Each unit that runs the engage ladder builds its `EngageSpec` (`engageSpec` in `conflict/engagement.ts`,
`hunterEngageSpec` in `conflict/hunting/`): about ten closures plus the spec, `hold` and `defend`
objects, whichever rungs it goes on to read. Measured on `krwawa_rzeka` at t100k
(`docs/perf/heavy-load-krwawa-rzeka-12ai.md`): about 346 units act a tick, and `engageSpec` allocates
166 KB a tick under `ON_BENCH_PROFILE=alloc`, garbage the scavenger pays for. The spec is also held by
`resolveTarget`, `chase`, `breakOff`, `restPreySearch` and `holdPrey` for the rest of the unit's turn.

## Scope

- Build the filters once per pass instead: a reusable spec whose accept, keep and low-priority
  functions read per-unit fields set before the unit's search, or closures built only on the rung that
  reads them. A nested query inside `accept` (the hunter's last-resort gate) must still see its own
  seeker's fields.
- Hash-identical: the same filters in the same order.

## Verify

- `engageSpec` KB per tick from the reference's t100k checkpoint with `ON_BENCH_PROFILE=alloc`, before
  and after.
- State hash unchanged over 2000 ticks from the t80k and t100k checkpoints; the conflict tests and
  goldens unchanged.
- `npm test`, `npm run check`.
