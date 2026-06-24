import type { ContentSet } from '@vinland/data';
import { Position, Velocity } from '../components/index.js';
import type { World } from '../ecs/world.js';
import type { EventBuffer } from '../events.js';
import { fx } from '../fixed.js';
import type { Rng } from '../rng.js';

/**
 * A System is a pure function over the world for one tick. Systems run in a fixed registered
 * order (see SYSTEM_ORDER below and docs/ECS.md). They may read/write components and use ctx.rng,
 * but must not touch wall-clock, Math.random, the DOM, or I/O.
 */
export interface SystemContext {
  readonly content: ContentSet;
  readonly rng: Rng;
  /** Monotonic tick counter. */
  readonly tick: number;
  /** Emit one-shot events for render/audio (never read back in sim logic). */
  readonly events: EventBuffer;
}

export type System = (world: World, ctx: SystemContext) => void;

/**
 * MovementSystem — the one real system in the slice: advance positions by velocity.
 * Fixed-point only. Demonstrates the query + deterministic iteration pattern.
 */
export const movementSystem: System = (world) => {
  for (const e of world.query(Position, Velocity)) {
    const p = world.get(e, Position);
    const v = world.get(e, Velocity);
    p.x = fx.add(p.x, v.x);
    p.y = fx.add(p.y, v.y);
  }
};

/* ----------------------------------------------------------------------------------------------
 * The remaining systems are stubs to be implemented per docs/ROADMAP.md. They are listed here so
 * the execution order and intent are explicit and version-controlled. Each maps onto original
 * content types (goodtypes/jobtypes/housetypes/weapontypes/animaltypes/vehicletypes/tribetypes).
 * -------------------------------------------------------------------------------------------- */
const todo =
  (name: string): System =>
  () => {
    /* not yet implemented — see docs/ROADMAP.md */
    void name;
  };

export const commandSystem: System = todo('CommandSystem'); // apply queued serializable player commands
export const timeSystem: System = todo('TimeSystem'); // advance clock / day / season
export const terrainSystem: System = todo('TerrainSystem'); // resource regrowth, fertility (cell graph)
export const needsSystem: System = todo('NeedsSystem'); // hunger/health + the food/goods chain
export const progressionSystem: System = todo('ProgressionSystem'); // experience + tech graph (needfor*/allow*/jobEnables*) gates jobs/goods/houses/vehicles
export const aiSystem: System = todo('AISystem'); // planner: pick the next ATOMIC for each idle settler (utility over allowed atomics)
export const atomicSystem: System = todo('AtomicSystem'); // advance the CurrentAtomic; on completion apply its effect + notify planner
export const jobSystem: System = todo('JobSystem'); // match idle settlers to open jobs/workplaces
export const pathfindingSystem: System = todo('PathfindingSystem'); // A* on the cell-adjacency graph, canonical tie-breaking (budgeted/tick)
export const productionSystem: System = todo('ProductionSystem'); // recipes (goodtypes.productionInputGoods): inputs -> outputs, enforce stock capacity
export const transportSystem: System = todo('TransportSystem'); // carriers physically haul goods between stores (no global bank)
export const constructionSystem: System = todo('ConstructionSystem'); // deliver materials, advance build, level houses
export const combatSystem: System = todo('CombatSystem'); // N-tribe combat from weapontypes/armortypes (large subsystem)
export const reproductionSystem: System = todo('ReproductionSystem'); // families/children, gated by house level capacity
export const cleanupSystem: System = todo('CleanupSystem'); // destroy dead entities (ids are NOT recycled), emit events for render/audio

/**
 * The canonical per-tick execution order. Order is part of the design — change deliberately.
 * Note the AI->Atomic split: AISystem chooses an atomic, AtomicSystem executes it to completion.
 * Most "behavior" lives in these two + the data-driven atomic vocabulary, not in bespoke systems.
 */
export const SYSTEM_ORDER: readonly System[] = [
  commandSystem,
  timeSystem,
  terrainSystem,
  needsSystem,
  progressionSystem,
  aiSystem,
  jobSystem,
  pathfindingSystem,
  movementSystem,
  atomicSystem,
  productionSystem,
  transportSystem,
  constructionSystem,
  combatSystem,
  reproductionSystem,
  cleanupSystem,
];
