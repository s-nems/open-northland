import { BUILDING_KIND } from '@open-northland/data';
import { Building, Upgrading } from '../../../../components/index.js';
import type { PlayerCommand } from '../../../../core/commands/index.js';
import { contentIndex } from '../../../../core/content-index.js';
import type { Entity, World } from '../../../../ecs/world.js';
import type { SystemContext } from '../../../context.js';
import { LATE_GAME_FROM_TICKS } from '../../game-phase.js';
import { liftCommand, liftTarget } from '../../top-tier.js';
import { suppliedUpgrade } from './upgrade-supply.js';

/**
 * Owner ruling: the computer player never leaves a warehouse below the top tier. A paper or a lost base can
 * still stand one lower, the tier the rules allowed then: the first such home warehouse is upgraded
 * straight to the highest tier the seat has enabled, once the store backs that bill
 * ({@link suppliedUpgrade}), one warehouse at a time, from the late game, when the warehouse lane opens:
 * earlier the site and its stone blocks and bricks go to the economy's first buildings. The seat's base stays
 * as it is: closed while it rose, the seat would have no hub.
 */
export function homeStoreLift(
  world: World,
  ctx: SystemContext,
  player: number,
  owned: readonly Entity[],
  base: Entity,
): PlayerCommand | null {
  if (ctx.tick < LATE_GAME_FROM_TICKS) return null;
  const buildings = contentIndex(ctx.content).buildings;
  const stores = owned.filter(
    (e) => buildings.get(world.get(e, Building).buildingType)?.kind === BUILDING_KIND.storage,
  );
  if (stores.some((e) => world.has(e, Upgrading))) return null;
  for (const store of stores) {
    if (store === base) continue;
    const target = liftTarget(world, ctx, player, store);
    if (target === undefined) continue;
    const reach = suppliedUpgrade(world, ctx, player, owned, store, [target.typeId]);
    if (reach !== undefined) return liftCommand(store, target);
  }
  return null;
}
