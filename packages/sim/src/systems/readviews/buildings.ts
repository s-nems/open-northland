import { BUILDING_KIND, type BuildingType, type PrayerSite } from '@open-northland/data';
import { Building, UnderConstruction } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import { ONE } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';

/** The content id of the seat's headquarters, the start building a fortress-style map opens with. */
export const HEADQUARTERS_BUILDING_ID = 'headquarters';

/**
 * Siege classes: headquarters and defensive towers precede ordinary buildings in automatic targeting,
 * while `'other'` is the fallback tier a warrior turns on only when nothing better is in sight, the
 * barracks excepted ({@link ranksWithTowers}). A `'wall'` is struck like a palisade: on an order or when
 * it bars the way, never picked on sight. An unknown type reads as `'other'`.
 */
export type BuildingCombatClass = 'hq' | 'tower' | 'wall' | 'other';

export function buildingCombatClass(ctx: SystemContext, buildingType: number): BuildingCombatClass {
  const type = contentIndex(ctx.content).buildings.get(buildingType);
  return type === undefined ? 'other' : combatClassOfType(type);
}

export function combatClassOfType(type: Pick<BuildingType, 'id' | 'kind' | 'workers'>): BuildingCombatClass {
  if (type.id === HEADQUARTERS_BUILDING_ID) return 'hq';
  // The defence wall shares the towers' `logicmaintype` and differs only in having no posts to man.
  if (type.kind === BUILDING_KIND.tower) return type.workers.length > 0 ? 'tower' : 'wall';
  return 'other';
}

/** A standing building of the {@link BuildingCombatClass} `'wall'`. */
export function isWallBuilding(world: World, ctx: SystemContext, e: Entity): boolean {
  const b = world.tryGet(e, Building);
  return b !== undefined && buildingCombatClass(ctx, b.buildingType) === 'wall';
}

/** Whether a building of `buildingType` ranks with the towers in a fighter's first combat priority: a
 *  manned tower type, or the barracks. Original behavior: the barracks stands on the military house list
 *  beside the towers and the headquarters, the list a fighter's first scan takes houses from. */
export function ranksWithTowers(ctx: SystemContext, buildingType: number): boolean {
  const type = contentIndex(ctx.content).buildings.get(buildingType);
  return type !== undefined && (combatClassOfType(type) === 'tower' || isBarracksType(type));
}

/** A building a fighter takes only when no other building is in sight: an `'other'` one that is not the
 *  barracks. A settler, a headquarters, a tower, a wall and any non-building entity are never one. */
export function isLowPriorityBuildingTarget(world: World, ctx: SystemContext, t: Entity): boolean {
  const b = world.tryGet(t, Building);
  if (b === undefined) return false;
  const type = contentIndex(ctx.content).buildings.get(b.buildingType);
  return type === undefined || (combatClassOfType(type) === 'other' && !isBarracksType(type));
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
  return !world.has(building, UnderConstruction) && isBarracksOrFoundation(world, ctx, building);
}

/** A barracks, standing or still a foundation: a recruit may be sent to one before it stands. */
export function isBarracksOrFoundation(world: World, ctx: SystemContext, building: Entity): boolean {
  if (!world.isAlive(building)) return false;
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
