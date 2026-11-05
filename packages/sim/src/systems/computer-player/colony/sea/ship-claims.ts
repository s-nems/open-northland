import { type ColonyRoute, Health, Vehicle } from '../../../../components/index.js';
import { contentIndex } from '../../../../core/content-index.js';
import type { Entity } from '../../../../ecs/world.js';
import { freeShips } from '../../military/operations/landing.js';
import { type ColonyEnv, homeLandOf } from '../env.js';
import { mayBuildTradeShip } from './fleet.js';
import { TRADE_SHIP_ID } from './trade-ship.js';

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
