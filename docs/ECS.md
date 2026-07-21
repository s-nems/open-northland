# Simulation and ECS

The simulation uses a small Entity-Component-System implementation in `packages/sim/src/ecs/`. It is
kept local so iteration, ownership, and mutation rules remain explicit.

## Core model

- An entity is a numeric id from a monotonic counter. Ids are not reused.
- A component is plain data attached to an entity. Components have no methods.
- A system is a function that updates the world once per tick.
- A `World` owns its entities, component stores, and mutation version.
- `Simulation` owns the world, seeded RNG, content, command queue, events, and system schedule.

Many simulations can exist in one process. Creating a new `Simulation` or `World` is a complete
reset; there are no global component stores to clear.

Positions and velocities use the branded `Fixed` type. Create values through `fx.*` helpers instead
of casting numbers.

## Atomic actions

Settler work is assembled from small numbered actions called atomics. Original configuration binds
atomics to jobs, goods, tribes, and animations. The simulation uses those bindings to plan sequences
such as:

```text
walk to tree -> harvest -> carry wood -> walk to store -> deposit
```

`CurrentAtomic` records the action in progress. The agent planner chooses the next action, movement
systems route and move the settler, and the atomic system applies the effect at the authored point in
the animation.

This is why jobs and goods are content data. A new trade should normally extend the same planning and
atomic machinery instead of adding a one-off system for that trade.

## Progression

Jobs, training, goods, buildings, and vehicles form a dependency graph extracted from content.
Progression code resolves that graph from experience and settlement state. Tribe-specific behavior
belongs in tribe data and atomic bindings, not in hardcoded identity checks.

## Tick schedule

The canonical order is `SYSTEM_ORDER` in `packages/sim/src/systems/schedule.ts`. At a high level, a
tick runs these phases:

1. apply commands and update needs, jobs, orders, family, and social state;
2. plan agent work, then route, move, and separate units;
3. advance atomics and economy systems, including production, growth, and construction;
4. update vision, combat, projectiles, ageing, and cleanup;
5. let the strategic AI inspect the settled world and queue commands for the next tick.

Order is part of behavior. If a change depends on moving a system, add a focused test that explains
the required before/after relationship.

## Determinism

Identical seed, content, map, and command input must produce identical state bytes. The practical
rules are:

- use the simulation RNG, never `Math.random`;
- use fixed-point state, never accumulated floats;
- do not read time, DOM, files, or network state;
- canonicalize only choices where iteration order decides a winner;
- keep commands serializable;
- hash and snapshot plain state, not presentation objects.

Queries have deterministic insertion order. Sort ids for canonical serialization and for decisions
whose result would otherwise depend on which entity is encountered first. Membership checks and
commutative sums do not need sorting.

See [`../packages/sim/AGENTS.md`](../packages/sim/AGENTS.md) and [`TESTING.md`](TESTING.md) for the
enforced rules and golden tests.

## Terrain and navigation

Imported maps use a staggered cell raster for display and a `2W x 2H` half-cell lattice for logic.
Cell `(column, row)` maps to node `(2 * column + (row & 1), 2 * row)`.

Simulation commands, footprints, placement, and navigation use integer half-cell nodes. Fixed-point
positions remain fractional visual-tile coordinates. `packages/sim/src/nav/halfcell.ts` is the
conversion seam.

The terrain graph is an immutable world resource rather than a set of entities. Landscape types
provide walkability and occupancy capacity. Ground triangle classes provide additional collision
facts for imported maps. Visual terrain transitions are render data and are not a navigation model.

Pathfinding must use deterministic tie-breaking and scale with active path requests, not every pair
of entities.

## Snapshots and authored setup

Scenes and fixtures may assemble the world directly before tick zero. Once ticking starts, external
callers submit commands instead of mutating component stores.

`sim.snapshot()` clones the observable state into detached plain data. Render, audio, and UI consume
that view. The future on-disk save format is separate work; a runtime snapshot is not automatically a
compatible save file.
