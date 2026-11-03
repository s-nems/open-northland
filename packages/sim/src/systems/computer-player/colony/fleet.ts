import { type ColonyState, colonyRuns, playerPlacementTribes } from '../../../components/index.js';
import type { DeepReadonly, World } from '../../../ecs/world.js';
import { goodTypeByContentId } from '../../ai-shared/content-lookup.js';
import { seatColonies } from '../../ai-shared/home-roster.js';
import type { SystemContext } from '../../context.js';
import { goodEnabled } from '../../progression/index.js';
import { seatArchetype } from '../build-order/seat-order.js';
import { lineWayClear } from './sea-danger.js';

/** Owner ruling: a seat that may build it sends its colony in the trade ship, whose hold takes everything. */
export const TRADE_SHIP_ID = 'ship_big';

/** Whether `seat`'s tribe may build the trade ship: of the five tribes only the Vikings list its good. */
export function mayBuildTradeShip(world: World, ctx: SystemContext, seat: number): boolean {
  const tribe = playerPlacementTribes(world, seat)?.[0];
  const good = goodTypeByContentId(ctx.content, TRADE_SHIP_ID);
  return tribe !== undefined && good !== undefined && goodEnabled(world, ctx, seat, tribe, good.typeId);
}

/** The phases a colony is owed its carrying ship in before the party has it: from the site's choice, so the
 *  joinery builds it while the scout sails rather than after (the trade ship took longer than the scouting
 *  on arabskie_wyspy_wolna_gra_mieszana). */
const SHIP_AHEAD_PHASES: ReadonlySet<ColonyState['phase']> = new Set(['siteChosen', 'scouting']);

/** Whether `colony` lacks a carrying ship: from the site's choice until it claims one, and for a trade
 *  route that lost its ship, while a way clear of the fire that took it remains. */
function shipOwed(ctx: SystemContext, colony: DeepReadonly<ColonyState>): boolean {
  if (colony.ship !== null) return false;
  const fitting =
    SHIP_AHEAD_PHASES.has(colony.phase) || (colony.phase === 'fittingOut' && colony.scout !== null);
  const settled = colony.phase === 'founding' || colony.phase === 'running';
  const routeOwed =
    settled &&
    (colony.route?.ship ?? null) === null &&
    lineWayClear(ctx.terrain, colony.dangers, colony.berth, colony.shore);
  return fitting || routeOwed;
}

/** The carrying ships `seat`'s colonies lack, one each at most. */
function shipsOwed(world: World, ctx: SystemContext, seat: number): number {
  return seatColonies(world, seat).filter((colony) => shipOwed(ctx, colony)).length;
}

/** Whether a seat that looks for colonies but holds none yet owes the first one's trade ship (authored: on
 *  arabskie_wyspy_wolna_gra_mieszana the trade ship, raised only once the scout came home, held the voyage
 *  longer than the scouting did). The seat's first ship is then the trade ship, which scouts the site and
 *  carries the party. */
function firstTradeShipOwed(world: World, seat: number): boolean {
  return (
    seatColonies(world, seat).length === 0 &&
    seatArchetype(world, seat) === 'islands' &&
    colonyRuns(world, seat)
  );
}

/** The trade ships the seat's joinery owes its colonies, the first colony's before its site is chosen. */
export function colonyTradeShips(world: World, ctx: SystemContext, seat: number): number {
  if (!mayBuildTradeShip(world, ctx, seat)) return 0;
  return firstTradeShipOwed(world, seat) ? 1 : shipsOwed(world, ctx, seat);
}

/** The small ships beside its landing fleet the seat's joinery owes the colonies of a tribe with no trade
 *  ship. */
export function colonySmallShips(world: World, ctx: SystemContext, seat: number): number {
  return mayBuildTradeShip(world, ctx, seat) ? 0 : shipsOwed(world, ctx, seat);
}
