import { BUILDING_KIND, type BuildingType } from '@open-northland/data';
import { Building, UnderConstruction } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';

/** The content id of the seat's headquarters, the start building a fortress-style map opens with. */
export const HEADQUARTERS_BUILDING_ID = 'headquarters';

/**
 * Siege priority: a headquarters and a defensive tower are auto-targeted on par with an enemy unit,
 * while `'other'` is the fallback tier a warrior turns on only when nothing better is in sight. An
 * unknown type reads as `'other'`.
 */
export type BuildingCombatClass = 'hq' | 'tower' | 'other';

export function buildingCombatClass(ctx: SystemContext, buildingType: number): BuildingCombatClass {
  const type = contentIndex(ctx.content).buildings.get(buildingType);
  if (type === undefined) return 'other';
  if (type.id === HEADQUARTERS_BUILDING_ID) return 'hq';
  if (type.kind === BUILDING_KIND.tower) return 'tower';
  return 'other';
}

/** A settler, a headquarters, a tower, and any non-building entity are never low-priority. */
export function isLowPriorityBuildingTarget(world: World, ctx: SystemContext, t: Entity): boolean {
  const b = world.tryGet(t, Building);
  return b !== undefined && buildingCombatClass(ctx, b.buildingType) === 'other';
}

/**
 * The house a settler drills at to become a soldier. `logicmaintype 4` (LEARN) holds exactly two houses,
 * and only the barracks employs anybody: `logicworker 24 4` against the school's none. A structural
 * signature, because the field that names the difference outright, `logicSchoolSize` 25 against the
 * school's 5, is readable but not carried into the IR.
 */
export function isBarracksType(type: Pick<BuildingType, 'kind' | 'workers'>): boolean {
  return type.kind === BUILDING_KIND.training && type.workers.length > 0;
}

/** A foundation still under construction is not a barracks yet. */
export function isBarracks(world: World, ctx: SystemContext, building: Entity): boolean {
  if (!world.isAlive(building) || world.has(building, UnderConstruction)) return false;
  const b = world.tryGet(building, Building);
  if (b === undefined) return false;
  const type = contentIndex(ctx.content).buildings.get(b.buildingType);
  return type !== undefined && isBarracksType(type);
}

/**
 * The satisfier site for the piety need. The original's "work temple" (`logictype 37`) is a
 * `logicmaintype 3` workplace declaring no `logicworker`, `logicstock` or `logicproduction`, so it
 * reaches the IR as a workplace with no workers, stock or recipes.
 *
 * Approximation: the temple-to-pray binding lives below the readable rule files, so the satisfier is
 * inferred from that structural signature.
 */
export function isTemple(world: World, ctx: SystemContext, building: Entity): boolean {
  const b = world.tryGet(building, Building);
  if (b === undefined) return false;
  const type = contentIndex(ctx.content).buildings.get(b.buildingType);
  if (type === undefined) return false;
  return type.kind === 'workplace' && type.recipes.length === 0 && type.workers.length === 0;
}
