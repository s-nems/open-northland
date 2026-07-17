# Decide a builder floor for tiny AI populations

**Area:** sim · **Origin:** ai-player workforce execution 2026-07-17 · **Priority:** P3
**Needs user:** whether the opening plan should reserve builders before hiring the gatherer trio
and the scout, and at what floor.

Observed in the completion test (`test/systems/ai-player-modules.test.ts`): with 4 starting men the
workforce allocator (user-plan priority: collectors → scout → staffing → builders) consumes the
whole pool before any builder exists, so both open construction sites sit at zero labor forever —
the seat deadlocks until a son grows up (~2×8192 ticks). With ≥5 men the list completes fine.

Scope once the user decides: either a named `MIN_BUILDERS` reserve the earlier steps may not dip
into, or an explicit "population < N ⇒ builders first" opening rule in
`packages/sim/src/systems/ai-player/workforce.ts`.

## Verify

- A 4-man seat still finishes its first building; existing module tests stay green;
  `npm test`, `npm run check`, `npm run build`.
