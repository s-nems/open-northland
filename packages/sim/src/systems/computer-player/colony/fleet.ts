import { aiControlEntity, ComputerColony, playerPlacementTribes } from '../../../components/index.js';
import type { World } from '../../../ecs/world.js';
import { goodTypeByContentId } from '../../ai-shared/content-lookup.js';
import type { SystemContext } from '../../context.js';
import { goodEnabled } from '../../progression/index.js';

/** Owner ruling: a seat that may build it sends its colony in the trade ship, whose hold takes everything. */
export const TRADE_SHIP_ID = 'ship_big';

/** Whether `seat`'s tribe may build the trade ship: of the five tribes only the Vikings list its good. */
export function mayBuildTradeShip(world: World, ctx: SystemContext, seat: number): boolean {
  const tribe = playerPlacementTribes(world, seat)?.[0];
  const good = goodTypeByContentId(ctx.content, TRADE_SHIP_ID);
  return tribe !== undefined && good !== undefined && goodEnabled(world, ctx, seat, tribe, good.typeId);
}

/** The carrying ship `seat`'s colony still lacks: 1 from the scout's return until it claims one. */
function shipOwed(world: World, seat: number): number {
  const carrier = aiControlEntity(world, seat);
  const colony = carrier === null ? undefined : world.tryGet(carrier, ComputerColony);
  return colony?.phase === 'fittingOut' && colony.ship === null && colony.scout !== null ? 1 : 0;
}

/** The trade ships the seat's joinery owes its colony. */
export function colonyTradeShips(world: World, ctx: SystemContext, seat: number): number {
  return shipOwed(world, seat) > 0 && mayBuildTradeShip(world, ctx, seat) ? 1 : 0;
}

/** The small ships beside its landing fleet the seat's joinery owes a colony of a tribe with no trade ship. */
export function colonySmallShips(world: World, ctx: SystemContext, seat: number): number {
  return mayBuildTradeShip(world, ctx, seat) ? 0 : shipOwed(world, seat);
}
