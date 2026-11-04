import { BUILDING_KIND, type BuildingType } from '@open-northland/data';
import { Building, Upgrading } from '../../../components/index.js';
import type { PlayerCommand } from '../../../core/commands/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity } from '../../../ecs/world.js';
import { tiersAtOrAbove } from '../../ai-shared/content-lookup.js';
import { homeBuildings } from '../../ai-shared/home-roster.js';
import { isBuilt } from '../../ai-shared/seat-roster.js';
import { sitesShortfalls } from '../build-order/upgrade-supply.js';
import { liftCommand, liftTarget } from '../top-tier.js';
import { recentThreat } from './garrison.js';
import { chainStepOf } from './industry.js';
import { stepTop } from './industry-read.js';
import { openSites, siteFree } from './plan.js';
import type { FoundingRead } from './posts.js';
import { storesHeld } from './provision.js';
import { homeStockOf } from './stock.js';
import { isColonyTower } from './towers.js';
import type { ColonyEnv, ColonyView } from './voyage.js';

/** One building the colony may lift, and to what. */
interface Lift {
  readonly building: Entity;
  readonly target: BuildingType;
}

/** The tier a standing chain workshop of `type` goes up to now: the level home's plan lifts it to, as
 *  far as the tribe has enabled ({@link stepTop}); undefined when it stands there already. */
function workshopTarget(env: ColonyEnv, type: BuildingType): BuildingType | undefined {
  const step = chainStepOf(type.id);
  const wanted = step === undefined ? undefined : stepTop(env, step);
  if (wanted === undefined || wanted.typeId === type.typeId) return undefined;
  const above = tiersAtOrAbove(contentIndex(env.ctx.content), type);
  return above.has(wanted.typeId) ? wanted : undefined;
}

/**
 * The colony's next lift (owner ruling: its workshops stand at the levels of home's build plan, its towers
 * go up to the upper tier over time, its homes to the top). Its workshops first, as their output is what
 * the colony is for, then its towers, then its homes. One at a time, each within its kind's site budget so a
 * home or tower waiting holds back no workshop, and only while no raider was seen lately: an upgrading
 * building stands closed, an upgrading tower shoots no one. The upgrade bill must already lie in the
 * colony's stores, which the trader's building floor fills, and home's sites may lack no good of it past
 * what home's stores hold (owner ruling: home's lack wins), so a lift never draws materials home's own
 * building waits on.
 */
export function liftColony(env: ColonyEnv, colony: ColonyView, read: FoundingRead): PlayerCommand[] {
  const { world, ctx, seat } = env;
  if (colony.phase !== 'running' || recentThreat(colony, ctx.tick) > 0) return [];
  if (read.buildings.some((e) => world.has(e, Upgrading))) return [];
  const index = contentIndex(ctx.content);
  const open = openSites(env, read.buildings);
  const workshops: Lift[] = [];
  const towers: Lift[] = [];
  const homes: Lift[] = [];
  for (const building of read.buildings) {
    if (!isBuilt(world, building)) continue;
    const type = index.buildings.get(world.get(building, Building).buildingType);
    if (type === undefined || !siteFree(type.id, open)) continue;
    if (chainStepOf(type.id) !== undefined) {
      const target = workshopTarget(env, type);
      if (target !== undefined) workshops.push({ building, target });
      continue;
    }
    const home = type.kind === BUILDING_KIND.home;
    if (!home && !isColonyTower(type.id)) continue;
    const target = liftTarget(world, ctx, seat, building);
    if (target !== undefined) (home ? homes : towers).push({ building, target });
  }
  let held: Map<number, number> | undefined;
  let homeLack: Map<number, number> | undefined;
  let stock: ReturnType<typeof homeStockOf> | undefined;
  // A good home's sites lack past what its stores hold: the trader refills the colony's floor from home.
  const homeShort = (good: number): boolean => {
    homeLack ??= sitesShortfalls(world, ctx, homeBuildings(world, ctx, seat));
    stock ??= homeStockOf(world, ctx, seat);
    return stock.units(good) < (homeLack.get(good) ?? 0);
  };
  const billHeld = (lift: Lift): boolean => {
    held ??= storesHeld(env, read.buildings);
    const stored = held;
    const from = world.get(lift.building, Building).buildingType;
    const bill = index.upgradeBillByTarget.get(from)?.get(lift.target.typeId);
    return (
      bill?.every((line) => (stored.get(line.goodType) ?? 0) >= line.amount && !homeShort(line.goodType)) ===
      true
    );
  };
  const lift = [...workshops, ...towers, ...homes].find(billHeld);
  return lift === undefined ? [] : [liftCommand(lift.building, lift.target)];
}
