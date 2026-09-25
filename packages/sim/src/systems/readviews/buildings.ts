import { BUILDING_KIND, type BuildingType, type PrayerSite } from '@open-northland/data';
import { Building, UnderConstruction } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import { ONE } from '../../core/fixed.js';
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
 * signature; `schoolSize` (25 against the school's 5) is a capacity, not a type tag.
 */
export function isBarracksType(type: Pick<BuildingType, 'kind' | 'workers'>): boolean {
  return type.kind === BUILDING_KIND.training && type.workers.length > 0;
}

/** The other LEARN house: the school, where civilians take their courses. */
export function isSchoolType(type: Pick<BuildingType, 'kind' | 'workers'>): boolean {
  return type.kind === BUILDING_KIND.training && !isBarracksType(type);
}

/** A foundation still under construction is not a barracks yet. */
export function isBarracks(world: World, ctx: SystemContext, building: Entity): boolean {
  if (!world.isAlive(building) || world.has(building, UnderConstruction)) return false;
  const b = world.tryGet(building, Building);
  if (b === undefined) return false;
  const type = contentIndex(ctx.content).buildings.get(b.buildingType);
  return type !== undefined && isBarracksType(type);
}

/** The prayer site a building type is, from content; undefined for every other type. */
export function prayerSiteOf(ctx: SystemContext, buildingType: number): PrayerSite | undefined {
  return contentIndex(ctx.content).buildings.get(buildingType)?.prayerSite;
}

/** A finished building of `site`: a foundation, or a building mid-upgrade, is not one yet. */
export function isFinishedPrayerSite(
  world: World,
  ctx: SystemContext,
  building: Entity,
  site: PrayerSite,
): boolean {
  if (world.has(building, UnderConstruction)) return false;
  const b = world.tryGet(building, Building);
  return b !== undefined && b.built >= ONE && prayerSiteOf(ctx, b.buildingType) === site;
}
