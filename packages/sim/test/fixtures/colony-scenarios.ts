import type { ContentSet } from '@open-northland/data';
import {
  aiControlEntity,
  type EconomicSide,
  Female,
  Marriage,
  StalledPlacements,
  TradeRoute,
  TradeShip,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import type { Simulation } from '../../src/index.js';
import { everySettlerOf } from '../../src/systems/ai-shared/home-roster.js';
import { DEFAULT_BUILD_ORDER } from '../../src/systems/computer-player/build-order/default-order.js';
import {
  type BuildLineId,
  type StepKey,
  stepKey,
} from '../../src/systems/computer-player/build-order/entries.js';
import { seatBuildOrder } from '../../src/systems/computer-player/build-order/seat-order.js';
import { surveyColonySite } from '../../src/systems/computer-player/colony/voyage/survey.js';
import { openColony } from '../../src/systems/computer-player/colony/voyage/voyage.js';
import { computerProfileOf } from '../../src/systems/computer-player/difficulty.js';
import { minutesToTicks } from '../../src/systems/computer-player/game-phase.js';
import { BUILDER, SEAT, VIKING, WOMAN } from '../systems/computer-player/support.js';
import {
  colonyContent,
  colonySettlersOf,
  colonyState,
  colonyWorld,
  mooredShip,
  overflowContent,
  SMALL_SHIP,
  stepUntil,
} from './colony-islands.js';
import { ctxOf } from './context.js';

const SITE_DUE_TICKS = minutesToTicks(2);
const SCOUT_DUE_TICKS = minutesToTicks(12);
const ROUTE_DUE_TICKS = minutesToTicks(20);
const RUNNING_DUE_TICKS = minutesToTicks(30);
const FIRST_LANDS_TICKS = minutesToTicks(40);
const SECOND_LINE_TICKS = minutesToTicks(60);
const SECOND_SHIP_AT = { x: 90, y: 100 };
const THIRD_SHIP_AT = { x: 90, y: 30 };
const FOURTH_SHIP_AT = { x: 90, y: 80 };
const SEED = 7;
/** Idle builders few enough that every one is past the colony's work. */
const IDLE_MEN = 8;
const IDLE_STEP = 2;
const NEVER_RETRY_TICK = Number.MAX_SAFE_INTEGER;
const ARMORY_ID = 'work_armory_00';

/** The colony's trader once the route stands: a trader with the ship pinned and both stops on its route. */
export function routeTrader(sim: Simulation): Entity | null {
  const route = colonyState(sim)?.route;
  const trader = route?.trader ?? null;
  if (trader === null || route?.ship == null) return null;
  const pinned = sim.world.tryGet(trader, TradeShip)?.vehicle === route.ship;
  return pinned && (sim.world.tryGet(trader, TradeRoute)?.stops.length ?? 0) === 2 ? trader : null;
}

/** The colony's trader once the route stands, which the test needs to go on. */
export function standingTrader(sim: Simulation): Entity {
  const trader = routeTrader(sim);
  if (trader === null) throw new Error('setup: no route trader');
  return trader;
}

/** A colony landed and its trade route standing. */
export function routedWorld(content?: ContentSet): {
  readonly sim: Simulation;
  readonly ship: Entity;
  readonly scout: Entity;
} {
  const sim = colonyWorld(undefined, content);
  stepUntil(sim, SITE_DUE_TICKS, () => colonyState(sim) !== undefined);
  const scout = mooredShip(sim);
  stepUntil(sim, SCOUT_DUE_TICKS, () => colonyState(sim)?.phase === 'fittingOut');
  const ship = mooredShip(sim, SMALL_SHIP, SECOND_SHIP_AT);
  if (!stepUntil(sim, ROUTE_DUE_TICKS, () => routeTrader(sim) !== null)) throw new Error('setup: no route');
  return { sim, ship, scout };
}

/** {@link IDLE_MEN} idle builders landed on the running colony, the first wed to a woman landed beside them. */
export function idleBuilders(sim: Simulation): {
  readonly idle: readonly Entity[];
  readonly husband: Entity;
} {
  const site = colonyState(sim)?.site;
  if (site === undefined) throw new Error('setup: no site');
  const before = new Set(everySettlerOf(sim.world, SEAT));
  const spawn = (jobType: number, x: number): void =>
    sim.enqueueSetup({ kind: 'spawnSettler', jobType, x, y: site.hy, tribe: VIKING, owner: SEAT });
  for (let i = 0; i < IDLE_MEN; i++) spawn(BUILDER, site.hx + IDLE_STEP * i);
  spawn(WOMAN, site.hx);
  sim.step();
  const fresh = colonySettlersOf(sim).filter((e) => !before.has(e));
  const wife = fresh.find((e) => sim.world.has(e, Female));
  const idle = fresh.filter((e) => !sim.world.has(e, Female));
  const husband = idle[0];
  if (wife === undefined || husband === undefined) throw new Error('setup: no couple on the colony');
  sim.world.add(wife, Marriage, { spouse: husband, child: null });
  sim.world.add(husband, Marriage, { spouse: wife, child: null });
  return { idle, husband };
}

/** Mark the step that places `building` as holding its line for ground, as a failed search leaves it. */
export function holdForGround(sim: Simulation, building: string): StepKey {
  const carrier = aiControlEntity(sim.world, SEAT);
  if (carrier === null) throw new Error('setup: no carrier');
  const ctx = ctxOf(sim);
  const order = seatBuildOrder(sim.world, ctx, SEAT, DEFAULT_BUILD_ORDER, computerProfileOf(sim.world, SEAT));
  for (const line of order.lines) {
    const step = line.steps.findIndex((entry) => 'building' in entry && entry.building === building);
    if (step < 0) continue;
    const key = stepKey(line.id, step);
    sim.world.add(carrier, StalledPlacements, {
      retryTicks: new Map([[key, NEVER_RETRY_TICK]]),
      holding: new Map<BuildLineId, StepKey>([[line.id, key]]),
    });
    return key;
  }
  throw new Error(`setup: no step places ${building}`);
}

/** A seat whose colony runs, with `building`'s step held since before the colony landed. */
export function runningWorld(
  building = ARMORY_ID,
  sides: readonly EconomicSide[] = ['noRoom'],
): { readonly sim: Simulation; readonly ship: Entity } {
  const sim = colonyWorld(7, overflowContent(), sides);
  holdForGround(sim, building);
  stepUntil(sim, SITE_DUE_TICKS, () => colonyState(sim) !== undefined);
  mooredShip(sim);
  stepUntil(sim, SCOUT_DUE_TICKS, () => colonyState(sim)?.phase === 'fittingOut');
  const ship = mooredShip(sim, SMALL_SHIP, SECOND_SHIP_AT);
  if (!stepUntil(sim, RUNNING_DUE_TICKS, () => colonyState(sim)?.phase === 'running'))
    throw new Error('setup: no running colony');
  return { sim, ship };
}

/** A seat with a route running on the east island, and the far island's colony on its way. */
export function twoColonies() {
  const sim = colonyWorld(SEED, colonyContent(), [], true);
  stepUntil(sim, FIRST_LANDS_TICKS, () => colonyState(sim) !== undefined);
  mooredShip(sim);
  stepUntil(sim, FIRST_LANDS_TICKS, () => colonyState(sim)?.phase === 'fittingOut');
  mooredShip(sim, SMALL_SHIP, SECOND_SHIP_AT);
  if (!stepUntil(sim, FIRST_LANDS_TICKS, () => (colonyState(sim)?.route?.ship ?? null) !== null))
    throw new Error('setup: no first route');
  const ctx = ctxOf(sim);
  const terrain = ctx.terrain;
  const carrier = aiControlEntity(sim.world, SEAT);
  if (terrain === undefined || carrier === null) throw new Error('setup: no terrain or carrier');
  const first = colonyState(sim)?.land;
  const site = surveyColonySite(sim.world, ctx, SEAT, [], (next) => next.land !== first);
  if (site === null) throw new Error('setup: no second site');
  openColony({ world: sim.world, ctx, terrain, seat: SEAT, carrier }, site);
  mooredShip(sim, SMALL_SHIP, THIRD_SHIP_AT);
  if (!stepUntil(sim, SECOND_LINE_TICKS, () => colonyState(sim, 1)?.phase === 'fittingOut'))
    throw new Error('setup: the second colony did not scout');
  mooredShip(sim, SMALL_SHIP, FOURTH_SHIP_AT);
  return sim;
}
