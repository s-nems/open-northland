import type { World } from '../ecs/world.js';
import type { Rng } from '../rng.js';
import type { ContentSet } from '@vinland/data';
import { Position, Velocity } from '../components/index.js';
import { fx } from '../fixed.js';

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

export const commandSystem: System = todo('CommandSystem'); // apply queued player commands
export const timeSystem: System = todo('TimeSystem'); // advance clock / day / season
export const terrainSystem: System = todo('TerrainSystem'); // resource regrowth, fertility
export const needsSystem: System = todo('NeedsSystem'); // hunger/health, the food chain
export const aiSystem: System = todo('AISystem'); // per-settler goal selection
export const jobSystem: System = todo('JobSystem'); // match idle settlers to open jobs
export const pathfindingSystem: System = todo('PathfindingSystem'); // paths on the landscape graph
export const productionSystem: System = todo('ProductionSystem'); // recipes: inputs -> outputs
export const transportSystem: System = todo('TransportSystem'); // carriers move goods
export const constructionSystem: System = todo('ConstructionSystem'); // build progress
export const combatSystem: System = todo('CombatSystem'); // two-tribe combat from weapontypes
export const reproductionSystem: System = todo('ReproductionSystem'); // families, population
export const cleanupSystem: System = todo('CleanupSystem'); // destroy dead, recycle, emit events

/** The canonical per-tick execution order. Order is part of the design — change deliberately. */
export const SYSTEM_ORDER: readonly System[] = [
  commandSystem,
  timeSystem,
  terrainSystem,
  needsSystem,
  aiSystem,
  jobSystem,
  pathfindingSystem,
  movementSystem,
  productionSystem,
  transportSystem,
  constructionSystem,
  combatSystem,
  reproductionSystem,
  cleanupSystem,
];
