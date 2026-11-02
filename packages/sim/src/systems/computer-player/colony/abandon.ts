import { BUILDING_KIND } from '@open-northland/data';
import { Building, Settler, Vehicle, vehiclePassengers } from '../../../components/index.js';
import type { PlayerCommand } from '../../../core/commands/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity } from '../../../ecs/world.js';
import { hexDistance } from '../../../nav/halfcell.js';
import { isBuilt } from '../../ai-shared/seat-roster.js';
import { passengerJobAllowed } from '../../vehicles/crew.js';
import { minutesToTicks } from '../game-phase.js';
import { visibleEnemyFighters } from '../military/operations/raid-target.js';
import { holdFlushed } from './cargo.js';
import { colonists } from './founding.js';
import {
  enterLeg,
  hullOf,
  type LineView,
  landPassengers,
  releaseLine,
  ridersOf,
  sail,
  stalled,
} from './line.js';
import { boardOrders } from './people.js';
import { colonyBuildings } from './spot.js';
import { bringScoutHome, type ColonyEnv, type ColonyView, dock, homeLandOf, mooredOn } from './voyage.js';

/** How near the site, in hex nodes, a seen enemy overruns a colony with no store (authored: a tower's
 *  clearance, the reach at which a landing keeps away). */
const OVERRUN_RANGE_NODES = 30;
/** How long survivors get to reach the ship before it sails without them (authored). */
const EVACUATION_BOARD_TICKS = minutesToTicks(4);

/** Whether the colony is lost: nobody stands there, or no store does and an enemy is seen near the site. */
export function overrun(env: ColonyEnv, colony: ColonyView): boolean {
  const { world, ctx, seat } = env;
  if (colonists(env).length === 0) return true;
  const buildings = contentIndex(ctx.content).buildings;
  const stands = colonyBuildings(env).some(
    (e) =>
      isBuilt(world, e) && buildings.get(world.get(e, Building).buildingType)?.kind === BUILDING_KIND.storage,
  );
  if (stands) return false;
  const site = { hx: colony.site.hx, hy: colony.site.hy };
  return visibleEnemyFighters(world, ctx, seat).some((f) => hexDistance(f.at, site) <= OVERRUN_RANGE_NODES);
}

/** The colony is given up for good. The people lists empty, as a survivor home again is home's; the land
 *  stays out of the home reads, and the line goes for whoever is left. */
export function abandonColony(env: ColonyEnv): void {
  const { world, ctx } = env;
  const live = env.edit();
  live.phase = 'abandoned';
  live.since = ctx.tick;
  live.people = [];
  live.rest = [];
  const ship = live.ship;
  if (ship !== null && live.line === null) {
    const crew = ridersOf(world, ship);
    live.line = {
      ship,
      crew,
      leg: 'sailOut',
      since: ctx.tick,
      load: 0,
      lastLoad: ctx.tick,
      hull: hullOf(world, ship),
    };
    live.ship = null;
  } else if (live.line !== null && (live.line.leg === 'unloadColony' || live.line.leg === 'loadColony')) {
    enterLeg(env, 'sailOut');
  } else if (live.line !== null && (live.line.leg === 'unloadHome' || live.line.leg === 'loadHome')) {
    enterLeg(env, 'sailHome');
  }
}

/** The colony's people `ship` may seat: its jobs leave out children, who stay. */
function survivorsFor(env: ColonyEnv, ship: Entity): Entity[] {
  const { world, ctx } = env;
  const state = world.tryGet(ship, Vehicle);
  const type = state === undefined ? undefined : contentIndex(ctx.content).vehicles.get(state.vehicleType);
  if (type === undefined) return [];
  return colonists(env).filter((e) => passengerJobAllowed(type, world.get(e, Settler).jobType));
}

/** Survivors take the ship's free seats and it docks at home, boarding them first. */
function takeSurvivors(env: ColonyEnv, colony: ColonyView, line: LineView): PlayerCommand[] {
  const { world } = env;
  if (colony.berth === null) return [];
  const seats = world.tryGet(line.ship, Vehicle)?.passengers.length ?? 0;
  const free = seats - ridersOf(world, line.ship).length;
  const survivors = survivorsFor(env, line.ship).slice(0, Math.max(0, free));
  enterLeg(env, 'sailHome');
  return [...boardOrders(world, survivors, line.ship), dock(line.ship, colony.berth)];
}

/** Riders who have not reached the ship in time stay behind, so the dock held for them goes on. */
function leaveLate(env: ColonyEnv, line: LineView): PlayerCommand[] {
  const { world, ctx } = env;
  const state = world.tryGet(line.ship, Vehicle);
  if (state === undefined || ctx.tick - line.since < EVACUATION_BOARD_TICKS) return [];
  return vehiclePassengers(state).flatMap((seat) =>
    seat.inside ? [] : [{ kind: 'detachFromVehicle', entity: seat.entity } as const],
  );
}

/**
 * An abandoned colony's last orders: the scout ship goes home, and the line ship fetches survivors a load at
 * a time, sets them ashore at home and is released. Nothing is rebuilt. With no ship left they stay where they
 * are, out of the home reads.
 */
export function evacuate(env: ColonyEnv, colony: ColonyView): PlayerCommand[] {
  const { world } = env;
  const commands = bringScoutHome(env, colony);
  const line = colony.line;
  if (line === null) return commands;
  if (!world.has(line.ship, Vehicle)) {
    env.edit().line = null;
    return commands;
  }
  const home = homeLandOf(env);
  const ship = line.ship;
  switch (line.leg) {
    case 'sailOut':
      commands.push(...sail(env, colony, line, 'shore', colony.land, () => takeSurvivors(env, colony, line)));
      break;
    case 'unloadHome': {
      if (!holdFlushed(world, ship) && !stalled(env, line)) break;
      if (survivorsFor(env, ship).length === 0 || colony.shore === null) {
        commands.push(...releaseLine(env, line));
        break;
      }
      enterLeg(env, 'sailOut');
      commands.push(dock(ship, colony.shore));
      break;
    }
    default:
      if (mooredOn(env, ship, colony.land)) commands.push(...leaveLate(env, line));
      commands.push(
        ...sail(env, colony, line, 'berth', home, () => {
          enterLeg(env, 'unloadHome');
          return [{ kind: 'clearVehicleWanted', vehicle: ship }, ...landPassengers(env, line)];
        }),
      );
  }
  return commands;
}
