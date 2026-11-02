import { type ColonyState, playerPlacementTribes } from '../../../components/index.js';
import type { DeepReadonly, World } from '../../../ecs/world.js';
import { goodTypeByContentId } from '../../ai-shared/content-lookup.js';
import { seatColonies } from '../../ai-shared/home-roster.js';
import type { SystemContext } from '../../context.js';
import { goodEnabled } from '../../progression/index.js';
import { lineWayClear } from './sea-danger.js';

/** Owner ruling: a seat that may build it sends its colony in the trade ship, whose hold takes everything. */
export const TRADE_SHIP_ID = 'ship_big';

/** Whether `seat`'s tribe may build the trade ship: of the five tribes only the Vikings list its good. */
export function mayBuildTradeShip(world: World, ctx: SystemContext, seat: number): boolean {
  const tribe = playerPlacementTribes(world, seat)?.[0];
  const good = goodTypeByContentId(ctx.content, TRADE_SHIP_ID);
  return tribe !== undefined && good !== undefined && goodEnabled(world, ctx, seat, tribe, good.typeId);
}

/** Whether `colony` lacks a carrying ship: from the scout's return until it claims one, and for a shipping
 *  line that lost its ship, while a way clear of the fire that took it remains. */
function shipOwed(ctx: SystemContext, colony: DeepReadonly<ColonyState>): boolean {
  if (colony.ship !== null) return false;
  const fitting = colony.phase === 'fittingOut' && colony.scout !== null;
  const settled = colony.phase === 'founding' || colony.phase === 'running';
  const lineOwed =
    settled && colony.line === null && lineWayClear(ctx.terrain, colony.dangers, colony.berth, colony.shore);
  return fitting || lineOwed;
}

/** The carrying ships `seat`'s colonies lack, one each at most. */
function shipsOwed(world: World, ctx: SystemContext, seat: number): number {
  return seatColonies(world, seat).filter((colony) => shipOwed(ctx, colony)).length;
}

/** The trade ships the seat's joinery owes its colonies. */
export function colonyTradeShips(world: World, ctx: SystemContext, seat: number): number {
  return mayBuildTradeShip(world, ctx, seat) ? shipsOwed(world, ctx, seat) : 0;
}

/** The small ships beside its landing fleet the seat's joinery owes the colonies of a tribe with no trade
 *  ship. */
export function colonySmallShips(world: World, ctx: SystemContext, seat: number): number {
  return mayBuildTradeShip(world, ctx, seat) ? 0 : shipsOwed(world, ctx, seat);
}
