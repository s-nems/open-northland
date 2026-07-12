# ECS & the simulation core

The sim is an **Entity-Component-System**. We use a tiny custom ECS (`packages/sim/src/ecs/`)
rather than a library, so we control iteration order (for determinism) and keep it legible.

## Core concepts

- **Entity** — an integer id from a **monotonic counter, never recycled** (entities are cheap; id
  reuse makes iteration order confusingly history-dependent). A settler, building, animal, goods
  stack, resource node are all entities.
- **Component** — plain data attached to an entity (`defineComponent`). **No methods, no behavior.**
  Positions/velocities are fixed-point (see below), never floats.
- **System** — a function `(world, ctx) => void` run once per tick in a fixed registered order.
  Systems hold all behavior.
- **World** — entities/components + per-world resources (RNG, clock, loaded content, terrain graph,
  command queue).

```ts
const Position = defineComponent<{ x: Fixed; y: Fixed }>('Position'); // fixed-point
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

## The atomic-action model (the soul of Cultures — read this twice)

Cultures settlers do **not** "do jobs" as monolithic system logic. Every behavior is an **atomic**
— a numbered micro-action bound, per tribe, to an animation. This is right there in the data:

- `tribetypes.ini`: `setatomic 5 10 "viking_woman_eat_slot_food"`, `5 81 attack`, `5 22 pickup`,
  `5 80 give_birth` — atomic id → animation, per tribe.
- `jobtypes.ini`: a job is a **list of `allowatomic` ids** (a collector adds harvest atomics 24–28).
- `goodtypes.ini`: production binds to atomics — `atomicForHarvesting 24`, `atomicForProduction 47`.
- Atomic *timing/effects* live in `atomicanimations.cif` (encrypted) — reconstruct by observation;
  the **vocabulary and per-tribe wiring are free** in the readable `.ini` above.

So behavior is a **planner sequencing atomics**, not bespoke per-job code:

- `CurrentAtomic` component = the atomic a settler is executing (id, progress 0→ONE, target).
- **AISystem** = the planner: for an idle settler, score goals and pick the next atomic from the
  job's allowed set (eat if hungry → find food in nearest store; else advance the assigned job's
  production by sequencing harvest/pickup/produce/pileup; else satisfy a social/enjoy need).
- **AtomicSystem** = execute `CurrentAtomic` to completion, apply its effect, notify the planner.

**Worked example — the woodcutter slice (implemented in Phase 2).** An idle woodcutter, empty-handed:
`aiSystem`'s `atomicPlanner` sees no `CurrentAtomic`, picks the `harvest` atomic the job permits, and
sets a `MoveGoal` to the nearest harvestable wood node. The navigation planner routes it
(`PathRequest` → A\* → `PathFollow`); `movementSystem` walks it there. On arrival the planner starts a
`harvest` `CurrentAtomic` whose duration comes from the tribe's `setatomic` → `AtomicAnimation.length`;
`atomicSystem` advances it to completion, applies the effect (the settler gains 1 wood, the node's
`Resource.remaining` drops 1), emits `atomicCompleted`, and removes the component. Now carrying, the
planner's next pick is a `MoveGoal` to the nearest store, then a `pileup` atomic depositing into its
`Stockpile`. No bespoke "woodcutter" code runs anywhere — the behavior is **data** (the job's atomics +
the good's `atomicFor*` + the tribe's bindings) sequenced by those two systems.

If you instead hardcode jobs as separate system logic, you'll build something that *looks* like
Cultures and *feels* wrong, and every new job becomes hand-written. Keep behavior data-driven.

## The progression / tech graph (first-class, not an afterthought)

The settlement's depth is a **data-driven dependency graph**, also in `tribetypes.ini`:
`needforjob`, `trainforjob` (schooling), `jobEnablesGood/Job/House/Vehicle`,
`toBuildHouseNeedJob/Good`, `toProduceGoodNeedHouse`, `allowjob/allowhouse/allowgood/allowvehicle`,
plus per-specialization experience (`humanjobexperiencetypes.ini`). **ProgressionSystem** owns this:
it gates what jobs/goods/houses/vehicles are available based on experience + schooling. Tribe
**asymmetry is mostly this graph + the atomic bindings**, so model a tribe as a data row carrying
its own graph — never hardcode tribe count or identities.

## Determinism rules (non-negotiable)

1. **No ambient nondeterminism.** No `Math.random`, `Date.now`, `Date`, `performance.now`. Use
   `world.rng` (seeded). No reliance on `Map`/`Set` iteration order for game decisions — iterate a
   **canonical** order (e.g. `stockpileEntries()` sorts by goodType). See the determinism
   anti-patterns in `packages/sim/AGENTS.md`.
2. **Deterministic iteration.** Queries iterate the smallest store in **insertion order** (no
   per-call sort — that was a perf trap). Order is reproducible across identical runs, which is what
   determinism needs. For canonical snapshots/hashes, sort ids explicitly (`world.canonicalEntities()`).
3. **Fixed-point math for anything that affects state.** `fx` helpers (`core/fixed.ts`): scaled integers
   in a JS double (exact to 2^53), with dev-mode overflow assertions. Never `Math.sqrt/sin/cos` in
   sim — use `fx.isqrt`. Floats are fine for pure rendering only.
4. **Commands in, snapshot out.** State mutates ONLY via serializable commands (CommandSystem). A
   tick consumes `(prevState, commands, rng)` and nothing else. This makes save = command log and
   keeps lockstep MP cheap — preserve it from Phase 2, don't add nondeterminism "for now".

`Simulation.hashState()` canonically hashes **all** components on all entities; the golden tests in
`packages/sim/test` are the tripwire. Also keep **golden atomic-action traces** (the sequence of
atomics a settler performs) — they catch behavior regressions a state hash can't explain. Intended
change → update the golden in the same commit. See docs/TESTING.md.

## System execution order (per tick)

Defined in `systems/index.ts` as `SYSTEM_ORDER`. Note the AI→Atomic split:

```
1.  CommandSystem       apply queued serializable player commands
2.  TimeSystem          advance clock / day / season
3.  TerrainSystem       resource regrowth, fertility (on the cell graph)
4.  NeedsSystem         hunger/health + the food/goods chain
5.  ProgressionSystem   experience + tech graph gates jobs/goods/houses/vehicles
6.  AISystem            planner: choose the next atomic for each idle settler
7.  JobSystem           match idle settlers to open jobs/workplaces
8.  PathfindingSystem   A* on the cell-adjacency graph, canonical tie-breaking (budgeted)
9.  MovementSystem      advance positions along paths (fixed-point)
10. AtomicSystem        advance CurrentAtomic; on completion apply effect + notify planner
11. ProductionSystem    recipes consume inputs → outputs, enforce stock capacity
12. TransportSystem     carriers physically haul goods between stores (no global bank)
13. ConstructionSystem  deliver materials, advance build, level houses
14. CombatSystem        N-tribe combat from weapontypes/armortypes
15. ReproductionSystem  families/children, gated by house-level capacity
16. CleanupSystem       destroy dead entities (ids NOT recycled), emit events for render/audio
```

## Terrain: navigation graph vs. render tessellation (keep these separate)

A common misconception: that Cultures' "triangle grid" is the *navigation* model. It isn't.

- **Navigation = a HALF-CELL adjacency graph** (the original's `2W×2H` logic lattice — the grid its
  map lanes, `map.cif` placements, and footprint offsets all address; cell `(c,r)` = node
  `(2c+(r&1), 2r)`). Each node has a landscape type carrying a per-node valency (capacity) and
  placement-layer flags (`landscapetypes.ini` — readable now). Walk cost is **uniform** per walkable
  step: that `.ini` carries no per-type movement weight (only `maximumValency` + the
  `allowedon{land,water,everything}` placement flags — neither is a traversal cost), and the
  original engine gates movement by walkability + valency, not a per-cell weight. So a variable
  walk-cost field is not a "pending extraction" from this table — it would need a source that has
  one. Pathfinding and placement operate here; this does **not** depend on triangle geometry.
- **Triangle pattern = a render-time concern.** `trianglepatterntypes.cif` governs how terrain
  types *blend visually* between cells. It lives in `render`, decoded later. Do **not** gate the
  sim slice on it.

Model the nav graph as a first-class world resource (`world.terrain`), not as entities. Pathfinding
uses A* (or flow-fields/HPA* later for scale) with **canonical tie-breaking** so paths are identical
across runs.

## Snapshot / save / multiplayer (design now, build later)

The command-log-plus-snapshot save model and lockstep-MP plan live in
docs/ARCHITECTURE.md ("Save / load & multiplayer"). The ECS-specific consequence: **every component
is plain data**, so a snapshot is a straightforward serialization — design the snapshot read-view
**in Phase 2** (so `render` reads a stable view, never mid-mutation), finalize the disk format in
Phase 5.

## What to build first

Don't build all 16 systems at once. Use `docs/tickets/` to define the next vertical slice:
cell-graph terrain → one settler → A* + movement → the atomic planner (harvest→pickup→carry→pileup)
→ one workplace with capacity → a carrier. Get it deterministic, invariant-clean, and trace-golden,
then widen.

## Why not floats / why not a big ECS library

- **Floats:** transcendental ops can differ across engines/CPUs; fatal for lockstep/replay. Scaled
  integers in a double are exact to 2^53 and identical everywhere (basic ops + round are
  IEEE-deterministic). See `core/fixed.ts`.
- **Big ECS libs:** `bitecs` is fast but terse and hard to follow, and we'd fight it for
  deterministic iteration order. At thousands (not millions) of entities a small explicit ECS wins
  on legibility with no real perf cost.
