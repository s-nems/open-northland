import { Building, playerPlacementTribes } from '../../../../components/index.js';
import { contentIndex } from '../../../../core/content-index.js';
import type { Entity } from '../../../../ecs/world.js';
import type { HalfCellNode } from '../../../../nav/halfcell.js';
import { buildingEnabled } from '../../../progression/index.js';
import { TOWER_CONTENT_IDS } from '../../build-order/ground/front.js';
import type { ColonyEnv, ColonyView } from '../env.js';
import { COLONY_TOWERS_LEAST, recentThreat } from './garrison.js';

/** A tower more per this many raiders seen about the colony lately (authored: a tower's three archers hold
 *  off about their own number). */
const RAIDERS_PER_TOWER = 3;
/** The most towers a colony raises (authored: a small garrison mans no more). */
const TOWERS_MOST = 3;

/** The towers a colony wants: none before a garrison is on its way, then {@link COLONY_TOWERS_LEAST} and one
 *  more per {@link RAIDERS_PER_TOWER} raiders seen lately, up to {@link TOWERS_MOST}. */
export function colonyTowerCount(garrisoned: boolean, raiders: number): number {
  if (!garrisoned) return 0;
  return Math.min(TOWERS_MOST, COLONY_TOWERS_LEAST + Math.floor(raiders / RAIDERS_PER_TOWER));
}

/** The lowest tower tier the seat's tribe has unlocked, by id, or null. */
function towerId(env: ColonyEnv): string | null {
  const { world, ctx, seat } = env;
  const tribe = playerPlacementTribes(world, seat)?.[0];
  const index = contentIndex(ctx.content);
  if (tribe === undefined) return null;
  return (
    TOWER_CONTENT_IDS.find((id) => {
      const typeId = index.buildingTypeBySlug.get(id);
      return typeId !== undefined && buildingEnabled(world, ctx, seat, tribe, typeId);
    }) ?? null
  );
}

/** Whether `building` is a colony tower. */
export function isColonyTower(building: string): boolean {
  return TOWER_CONTENT_IDS.includes(building);
}

/** How many of `buildings` are towers, sites included. */
function towersOf(env: ColonyEnv, buildings: readonly Entity[]): number {
  const index = contentIndex(env.ctx.content);
  return buildings.filter((e) => {
    const id = index.buildings.get(env.world.get(e, Building).buildingType)?.id;
    return id !== undefined && isColonyTower(id);
  }).length;
}

/** The towers the colony still lacks ({@link colonyTowerCount}), each a row of its plan. */
export function towersLacking(env: ColonyEnv, colony: ColonyView, buildings: readonly Entity[]): string[] {
  const id = towerId(env);
  if (id === null) return [];
  const want = colonyTowerCount(colony.garrison.length > 0, recentThreat(colony, env.ctx.tick));
  return new Array<string>(Math.max(0, want - towersOf(env, buildings))).fill(id);
}

/** Where the colony's next tower goes, from its store at `origin`: the first between the store and the shore,
 *  so one tower covers both; the next toward the last raiders seen, else by the store. */
export function towerAnchor(
  env: ColonyEnv,
  colony: ColonyView,
  origin: HalfCellNode,
  buildings: readonly Entity[],
): HalfCellNode {
  const { shore, threat } = colony;
  if (towersOf(env, buildings) === 0 && shore !== null)
    return { hx: Math.round((origin.hx + shore.hx) / 2), hy: Math.round((origin.hy + shore.hy) / 2) };
  if (threat !== null && recentThreat(colony, env.ctx.tick) > 0)
    return { hx: threat.at.hx, hy: threat.at.hy };
  return origin;
}
