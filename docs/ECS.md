# ECS & the simulation core

The sim is an **Entity-Component-System**. We use a tiny custom ECS (~a couple hundred lines, in
`packages/sim/src/ecs/`) rather than a library, so we control iteration order (for determinism)
and keep it legible.

## Core concepts

- **Entity** — just an integer id (`number`). A settler, a building, an animal, a goods stack, a
  map resource node are all entities.
- **Component** — plain data attached to an entity. Defined with `defineComponent`. Hot, dense
  components (position, movement) are stored structure-of-arrays for cache efficiency; sparse ones
  use maps. Components contain **no methods and no behavior** — just data.
- **System** — a function `(world, ctx) => void` run once per tick, in a fixed registered order.
  Systems hold all behavior. They query entities that have a given set of components and mutate
  component data.
- **World** — the container of all entities/components + per-world resources (the RNG, the game
  clock, the loaded content set, the terrain grid, command queue).

```ts
// shape (see packages/sim/src/ecs/world.ts for the real thing)
const Position = defineComponent<{ x: number; y: number }>('Position'); // x,y are fixed-point
const world = createWorld({ seed, content, map });

function movementSystem(world: World): void {
  for (const e of world.query(Position, Velocity)) {
    const p = world.get(e, Position);
    const v = world.get(e, Velocity);
    p.x = fx.add(p.x, v.x);
    p.y = fx.add(p.y, v.y);
  }
}
```

## Determinism rules (non-negotiable)

1. **No ambient nondeterminism.** No `Math.random`, `Date.now`, `Date`, `performance.now`,
   `Set`/`Map` iteration-order dependence on insertion you didn't control, or hashmap-order
   reliance. Use `world.rng` (seeded, `packages/sim/src/rng.ts`).
2. **Fixed iteration order.** Queries iterate entities in ascending id order. Systems run in a
   fixed registered order. Never depend on object key order.
3. **Fixed-point math for anything that affects state.** Positions, speeds, accumulators use the
   `fx` helpers (`packages/sim/src/fixed.ts`, Q16.16). Floats are fine for pure rendering only.
4. **Inputs in, snapshot out.** A tick consumes `(prevState, commands, rng)` and nothing else.

A golden test hashes world state after N ticks from a fixed seed and asserts the hash is stable.
Changing a mechanic intentionally? Update the golden. Breaking determinism accidentally? The test
catches it. See `packages/sim/test/determinism.test.ts`.

## System execution order (per tick)

The order matters and is part of the design. Initial proposed order — refine as systems land:

```
1.  CommandSystem        apply queued player commands (place building, set rally, etc.)
2.  TimeSystem           advance game clock / day / season
3.  TerrainSystem        resource regrowth (trees, fields, fish), fertility
4.  NeedsSystem          hunger/health decay; settlers get hungry, houses consume food (food chain)
5.  AISystem             per-settler decision: pick next goal (work / eat / rest / fight / flee)
6.  JobSystem            match idle settlers to open jobs at workplaces
7.  PathfindingSystem    compute/refresh paths on the landscape graph (budgeted per tick)
8.  MovementSystem       advance positions along paths (fixed-point)
9.  ProductionSystem     workplaces consume inputs → produce outputs over time
10. TransportSystem      carriers move goods between producers, stores, consumers
11. ConstructionSystem   deliver materials, advance build progress, finish buildings
12. CombatSystem         range/melee resolution between tribes; apply damage from weapontypes
13. ReproductionSystem   families, children, population growth/decline
14. CleanupSystem        destroy dead entities, recycle ids, emit events for render/audio
```

These map directly onto the original content types: `goodtypes`, `jobtypes`, `housetypes`,
`weapontypes`, `animaltypes`, `vehicletypes`, `tribetypes` — see `docs/DATA-FORMAT.md`.

## The terrain model

Cultures uses a **triangle/landscape pattern grid** (`trianglepatterntypes.cif`,
`landscapetypes.ini`), not a plain square grid: each cell has terrain type, height, and
walk/build constraints, and pattern transitions blend types. Pathfinding and building placement
operate on this graph. Treat the grid as a first-class world resource (`world.terrain`), not as
entities. This is one of the genuinely hard pieces — model it explicitly and test it in isolation.

## What to build first

Don't build all 14 systems at once. The roadmap (`docs/ROADMAP.md`) defines a vertical slice:
terrain → one settler → movement/pathfinding → gather → store → a single workplace producing one
good. Get that deterministic and tested, then widen.

## Why not floats / why not a big ECS library

- **Floats:** IEEE-754 results can differ across CPUs/JS engines/build flags for some operations;
  for lockstep replay/MP that is fatal. Fixed-point is boring and identical everywhere.
- **Big ECS libs:** `bitecs` is fast but terse and hard for humans/agents to follow; we'd also be
  fighting it for deterministic iteration order. A small explicit ECS is the better trade here.
