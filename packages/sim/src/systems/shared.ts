import type { Recipe } from '@vinland/data';
import { Building } from '../components/index.js';
import type { Entity, World } from '../ecs/world.js';
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
