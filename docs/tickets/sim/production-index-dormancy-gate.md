# Gate the production system's settler index on there being a workplace

**Area:** sim · **Origin:** sim refactor-cleanup review battery (deferred), 2026-07-17 · **Priority:** P3
(perf — no behavior change)

## Context

`productionSystem` (`packages/sim/src/systems/economy/production.ts:52-56`) builds its operator index —
`new NodeBuckets(world, canonicalById(world.query(Settler, Position)))` — as its first statement, before it
knows whether any `Production` building exists. On a map with no workshop (an early settlement, a
combat-only scenario, a fixture) the whole index is built and thrown away every tick.

The sibling systems already model the lever: `combatSystem` runs a cheap dormancy gate (`combatPossible`)
over the raw query and returns before paying for its `canonicalById` sort + `NodeBuckets` when no fight is
possible. Production has no such gate.

The cost is a full settler scan plus an `O(n log n)` canonical sort per tick. At today's scale (~2.8k
settlers) that is microseconds and not a live problem — this is a scaling-budget cleanup, filed rather than
done because it was outside the refactor pass's sanctioned scope.

Note the sort itself is contract-required and must stay: `NodeBuckets` is canonical only because its buckets
hold ascending ids (`systems/spatial.ts`). The saving is skipping the whole index, not skipping the sort.

## Scope

- Early-return before building the index when no `Production` + `Stockpile` building exists (the same
  membership-test-only shape as `combatPossible` — an any-match boolean, so it needs no canonical order).
- Keep the gate conservative: it may run on a tick that turns out to have no startable cycle, but must never
  skip a tick where a cycle could advance or start.

## Done when

- A map with no workshop pays no per-tick settler scan/sort for production.
- `npm test` green with **zero golden movement** (a moved golden means the gate changed a decision).
