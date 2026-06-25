import type { Recipe } from '@vinland/data';
import { Building, Position, Settler } from '../components/index.js';
import type { Entity, World } from '../ecs/world.js';
import { fx } from '../fixed.js';
import type { TerrainGraph } from '../terrain.js';
import type { SystemContext } from './context.js';

// The genuinely cross-system helpers, kept in a leaf module so every per-system file imports them
// from here (never from the barrel or from each other) — this breaks the import cycles the
// systems/ split would otherwise create. See docs/TECH-DEBT.md.

/**
 * The per-good capacity of a store's stockpile, from its building type's stock slots. A good with no
 * declared slot has no room (capacity 0); a store with no Building/type is treated as uncapped so a
 * test fixture without a building still accepts deposits.
 *
 * Cross-system: used by the AI store scan ({@link nearestStoreFor}), the atomic `pileup` deposit,
 * and production's `canStartCycle`/`depositOutputs`.
 */
export function stockCapacity(world: World, ctx: SystemContext, store: Entity, goodType: number): number {
  const building = world.tryGet(store, Building);
  if (building === undefined) return Number.MAX_SAFE_INTEGER; // bare store fixture: uncapped
  const type = ctx.content.buildings.find((b) => b.typeId === building.buildingType);
  if (type === undefined) return 0;
  const slot = type.stock.find((s) => s.goodType === goodType);
  return slot?.capacity ?? 0;
}

/**
 * The recipe a building's type declares, or undefined if it has no Building/type or no recipe.
 *
 * Cross-system: the AI uses it to recognise a workplace (haul source / never-deliver-back-to-producer),
 * and ProductionSystem uses it to run the cycle.
 */
export function recipeOf(world: World, ctx: SystemContext, building: Entity): Recipe | undefined {
  const b = world.tryGet(building, Building);
  if (b === undefined) return undefined;
  const type = ctx.content.buildings.find((t) => t.typeId === b.buildingType);
  return type?.recipe;
}

/**
 * The set of job types a building type's `workers` slots name (`logicworker <job> <count>`). Empty
 * if the building has no Building/type or declares no workers (an unstaffed-by-design building — a
 * passive store, or any type without worker slots).
 *
 * Cross-system: the production worker-presence gate ({@link workerPresentAt}) uses it to recognise a
 * settler that may operate the workplace, and the AI planner uses it to recognise a settler standing
 * on a workplace it staffs (so the operator isn't re-planned away).
 */
export function buildingWorkerJobs(world: World, ctx: SystemContext, building: Entity): ReadonlySet<number> {
  const b = world.tryGet(building, Building);
  if (b === undefined) return EMPTY_JOBS;
  const type = ctx.content.buildings.find((t) => t.typeId === b.buildingType);
  if (type === undefined || type.workers.length === 0) return EMPTY_JOBS;
  return new Set(type.workers.map((w) => w.jobType));
}

const EMPTY_JOBS: ReadonlySet<number> = new Set<number>();

/**
 * Whether a workplace is staffed *right now*: some {@link Settler} whose `jobType` matches one of the
 * building type's `workers` slots is standing on the workplace's tile. This is the production
 * worker-presence model — a workplace only produces while its worker is present, like the original
 * (a sawmill with no operator makes no planks).
 *
 * A building type that declares **no** worker slots is unstaffed-by-design and counts as always
 * present (passive stores / fixtures without workers keep working) — the gate constrains only a
 * workplace that actually names a worker. Presence is integer-tile coincidence (settler tile ==
 * building tile), so it needs no terrain graph and works on a mapless fixture too. The match is
 * canonical-order-independent (a boolean any-match, not a chosen entity), so no determinism concern.
 *
 * Cross-system: ProductionSystem gates both starting and advancing a cycle on this.
 */
export function workerPresentAt(world: World, ctx: SystemContext, building: Entity): boolean {
  const jobs = buildingWorkerJobs(world, ctx, building);
  if (jobs.size === 0) return true; // unstaffed-by-design: no worker requirement to satisfy
  const bp = world.tryGet(building, Position);
  if (bp === undefined) return false; // a placed-but-position-less workplace can't be stood on
  const bx = fx.toInt(bp.x);
  const by = fx.toInt(bp.y);
  for (const e of world.query(Settler, Position)) {
    const settler = world.get(e, Settler);
    if (settler.jobType === null || !jobs.has(settler.jobType)) continue;
    const p = world.get(e, Position);
    if (fx.toInt(p.x) === bx && fx.toInt(p.y) === by) return true;
  }
  return false;
}

/**
 * Whether a raw cell id is a valid index into the terrain graph (`0..cellCount-1`, integer). A
 * request/goal id outside the grid is boundary input — callers treat it as "no route" rather than
 * letting it throw inside the search.
 *
 * Cross-system: used by the AI navigation planner (drop an off-map goal) and the pathfinding system
 * (guard the A* endpoints).
 */
export function inRange(terrain: TerrainGraph, cell: number): boolean {
  return Number.isInteger(cell) && cell >= 0 && cell < terrain.cellCount;
}
