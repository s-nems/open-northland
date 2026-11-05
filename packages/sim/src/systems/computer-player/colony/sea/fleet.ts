import {
  type ColonyState,
  colonyRuns,
  playerPlacementTribes,
  Vehicle,
} from '../../../../components/index.js';
import { contentIndex } from '../../../../core/content-index.js';
import type { DeepReadonly, Entity, World } from '../../../../ecs/world.js';
import { goodTypeByContentId } from '../../../ai-shared/content-lookup.js';
import { colonyHeldShips, seatColonies } from '../../../ai-shared/home-roster.js';
import type { SystemContext } from '../../../context.js';
import { goodEnabled } from '../../../progression/index.js';
import { seatArchetype } from '../../build-order/order/seat-order.js';
import { lineWayClear } from './sea-danger.js';
import { TRADE_SHIP_ID } from './trade-ship.js';

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
 *  route or its relief without a ship, while a way clear of the fire that took the last remains. */
function shipOwed(ctx: SystemContext, colony: DeepReadonly<ColonyState>): boolean {
  if (colony.ship !== null) return false;
  const fitting =
    SHIP_AHEAD_PHASES.has(colony.phase) || (colony.phase === 'fittingOut' && colony.scout !== null);
  const settled = colony.phase === 'founding' || colony.phase === 'running';
  const routeOwed =
    settled &&
    ((colony.route?.ship ?? null) === null || (colony.relief !== null && colony.relief.ship === null)) &&
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

/** The ships `seat`'s colonies hold off the home fleet, less the scout of a colony with no carrying ship yet
 *  that may carry its party (a trade ship where the tribe builds one): it fills the slot the colony is owed. */
export function colonyFleetShips(world: World, ctx: SystemContext, seat: number): readonly Entity[] {
  const trade = mayBuildTradeShip(world, ctx, seat);
  const vehicles = contentIndex(ctx.content).vehicles;
  const carriers = new Set<Entity>();
  for (const colony of seatColonies(world, seat)) {
    const scout = colony.scout?.ship;
    if (colony.ship !== null || scout === undefined) continue;
    const type = world.tryGet(scout, Vehicle)?.vehicleType;
    if (!trade || (type !== undefined && vehicles.get(type)?.id === TRADE_SHIP_ID)) carriers.add(scout);
  }
  const held = colonyHeldShips(world, seat);
  return carriers.size === 0 ? held : held.filter((e) => !carriers.has(e));
}
