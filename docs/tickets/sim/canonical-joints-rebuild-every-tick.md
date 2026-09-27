# Keep canonical joint lists per membership change and iterate them without garbage

**Area:** sim · **Focus:** ecs/canonical-queries · **Priority:** P2

`CanonicalQueries.query` (`ecs/canonical-queries.ts`) memoizes a multi-component result until any
required component's epoch moves, then rebuilds it whole: a `filter` over the smallest member list
against every other store, frozen. `Position` gains and loses members every tick (projectiles,
boarding, deaths, births), so every joint that requires `Position` rebuilds about once a tick
whatever changed in its other components. The per-tick pass over each joint's members is a rule-6
violation (`AGENTS.md`), and the frozen results cost a second allocation at every reader:
`for...of` over a frozen array allocates an iterator result per element (40 B) even in optimized
code, and a loop site that has once seen a frozen array keeps doing so for plain arrays.

Measured on `krwawa_rzeka`, 12 AI seats, t100k (`docs/perf/heavy-load-krwawa-rzeka-12ai.md`,
`ON_BENCH_PROFILE=alloc`; the tick allocates 5.2 MB): the joint rebuilds allocate 961 KB a tick
(18.5%), led by `Stockpile, Position` (3654 members), `Settler, Health, Position` (1693) and
`Person, Position` (1339), for `collectTargets`, `combatSystem` and `animalWander`. Iterator results
over frozen lists are another 862 KB a tick (16.6%): `nearestByCell`, `NodeBuckets.refill`,
`nearestRaiderWithin`, the `CombatIndex` build, `combatSystem`, `entryStatus`. In-process A/B runs
from the same checkpoint, hash-identical over 600 ticks: joints kept per change saved 738 KB a tick
and cut scavenges per 5000 ticks from 892 to 750; not freezing the shared arrays saved 430 to
490 KB; both together 1227 KB (-20%) and 892 to 683 scavenges.

## Scope

- A joint registers with each component it requires; `entered` and `left` insert or remove the entity
  in the joint's sorted list when it carries (or no longer carries) every other required component.
  The copy handed to readers is made only when that joint's own list changed.
- Shared results stop being `Object.freeze`d on normal runs. The guarantee that no caller mutates one
  moves to the invariant-checked runs (the cache verifier already compares each list against the
  stores) and to `readonly` types. Restate the guarantee in `packages/sim/AGENTS.md` and the
  `World.canonicalQuery` doc; the same applies to the other runtime freezes of hot lists
  (`canonicalEntities`, `spatial/region.ts`, `ai-player/seat-roster.ts`, `defence/threat.ts`,
  `family/quality-search.ts`, `vehicles/registry.ts`).
- `NodeBuckets.refill` and `nearestByCell` take `readonly Entity[]` with index loops instead of a
  megamorphic `Iterable`.

## Verify

- `ON_BENCH_PROFILE=alloc` from the reference's t100k checkpoint: KB per tick and the canonical and
  `next` rows against the numbers above; `bench:map` GC count and ms per window.
- State hash unchanged over a 2000-tick run from the checkpoint; goldens unchanged; the cache
  verifier and canonical query tests pass.
- `npm test`, `npm run check`.
