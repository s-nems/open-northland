import {
  type ColonyRoute,
  type ColonyState,
  colonyRuns,
  Health,
  playerPlacementTribes,
  Vehicle,
} from '../../../../components/index.js';
import { contentIndex } from '../../../../core/content-index.js';
import type { DeepReadonly, Entity, World } from '../../../../ecs/world.js';
import { goodTypeByContentId } from '../../../ai-shared/content-lookup.js';
import { seatColonies } from '../../../ai-shared/home-roster.js';
import type { SystemContext } from '../../../context.js';
import { goodEnabled } from '../../../progression/index.js';
import { seatArchetype } from '../../build-order/order/seat-order.js';
import { freeShips } from '../../military/operations/landing.js';
import { type ColonyEnv, homeLandOf } from '../env.js';
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

export function shipId(env: ColonyEnv, ship: Entity): string | undefined {
  const type = env.world.tryGet(ship, Vehicle)?.vehicleType;
  return type === undefined ? undefined : contentIndex(env.ctx.content).vehicles.get(type)?.id;
}

/** The seat's free moored ship that may carry its colony: a trade ship where its tribe builds one. */
export function carryingShip(env: ColonyEnv): Entity | null {
  const { world, ctx, seat } = env;
  const wantsTrade = mayBuildTradeShip(world, ctx, seat);
  const free = freeShips(env, homeLandOf(env));
  return free.find((e) => !wantsTrade || shipId(env, e) === TRADE_SHIP_ID) ?? null;
}

/** Which of a colony's routes a decision works: its first, or the relief raised once that cannot keep up. */
export type RouteSlot = 'route' | 'relief';

/** A route of no trader and no ship yet, behind on nothing. */
export function newRoute(tick: number, ship: Entity | null, hull: number): ColonyRoute {
  return { trader: null, chosen: tick, ship, hull, load: 0, behindSince: null };
}

/** The colony takes `ship` for its route: the founding ship once its hold is out, or a free one at home. */
export function takeRouteShip(env: ColonyEnv, ship: Entity, slot: RouteSlot = 'route'): void {
  const { world, ctx } = env;
  const live = env.edit();
  const hull = world.tryGet(ship, Health)?.hitpoints ?? 0;
  const held = live[slot];
  if (held === null) live[slot] = newRoute(ctx.tick, ship, hull);
  else Object.assign(held, { ship, hull, load: 0 });
}
