import { BUILDING_KIND, type BuildingType } from '@open-northland/data';
import { Building, playerPlacementTribes, UnderConstruction, Upgrading } from '../../../components/index.js';
import type { PlayerCommand } from '../../../core/commands/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { World } from '../../../ecs/world.js';
import { buildingTypeByContentId } from '../../ai-shared/content-lookup.js';
import type { SystemContext } from '../../context.js';
import { holdsUpgradeBill, liftCommand, liftTarget, topEnabledTier } from '../top-tier.js';
import { recentThreat } from './garrison.js';
import { COLONY_OPEN_SITES } from './plan.js';
import type { FoundingRead } from './posts.js';
import { COLONY_STORE_BUILDING_ID } from './survey.js';
import type { ColonyEnv, ColonyView } from './voyage.js';

/** The warehouse tier a colony places (owner ruling: level 3, a trader trades from no lower one): the
 *  highest tier of the store chain `seat` has enabled, placed outright; while the top is not yet enabled, the
 *  highest that is, which {@link liftStore} raises to the top later. Undefined for a seat with no tribe or a
 *  content with no store. */
export function colonyStoreType(world: World, ctx: SystemContext, seat: number): BuildingType | undefined {
  const base = buildingTypeByContentId(ctx.content, COLONY_STORE_BUILDING_ID);
  const tribe = playerPlacementTribes(world, seat)?.[0];
  return base === undefined || tribe === undefined
    ? undefined
    : topEnabledTier(world, ctx, seat, tribe, base);
}

/** Owner ruling: no warehouse stays below the top tier. A store placed lower, before the top tier was
 *  enabled, goes straight up to it once the colony runs and the store's own pile holds the whole upgrade
 *  bill: it then stands closed only while its builders work, and never with raiders about, since a colony
 *  with no standing store is overrun by a band that outnumbers its men (`./abandon.ts`). */
export function liftStore(env: ColonyEnv, colony: ColonyView, read: FoundingRead): PlayerCommand[] {
  const { world, ctx, seat } = env;
  if (colony.phase !== 'running' || recentThreat(colony, ctx.tick) > 0) return [];
  if (read.buildings.filter((e) => world.has(e, UnderConstruction)).length >= COLONY_OPEN_SITES) return [];
  const index = contentIndex(ctx.content);
  const stores = read.buildings.filter(
    (e) => index.buildings.get(world.get(e, Building).buildingType)?.kind === BUILDING_KIND.storage,
  );
  if (stores.some((e) => world.has(e, Upgrading))) return [];
  for (const store of stores) {
    const target = liftTarget(world, ctx, seat, store);
    if (target !== undefined && holdsUpgradeBill(world, ctx, store, target.typeId))
      return [liftCommand(store, target)];
  }
  return [];
}
