import {
  ComputerColony,
  Settler,
  Vehicle,
  type VehicleSeat,
  vehiclePassengers,
} from '../../../components/index.js';
import type { PlayerCommand } from '../../../core/commands/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { DeepReadonly, Entity } from '../../../ecs/world.js';
import type { HalfCellNode } from '../../../nav/halfcell.js';
import { colonyHeldShips } from '../../ai-shared/home-roster.js';
import { isAllocatableMan } from '../../ai-shared/workforce/pool.js';
import { CIVILIST_JOB } from '../../lifecycle/ageclass.js';
import { isFighterJob, isTraderJob } from '../../readviews/index.js';
import { isShipVehicle } from '../../readviews/vehicles.js';
import { vehicleIndex } from '../../vehicles/registry.js';
import { colonists } from './founding.js';
import {
  type ColonyEnv,
  type ColonyView,
  dock,
  homeLandOf,
  lyingStill,
  mooredOn,
  mooringOf,
  type SeatEnv,
  unloadAt,
} from './voyage.js';

/** The seat's ships no colony holds, with their riders. */
function strayShips(env: SeatEnv): { ship: Entity; riders: DeepReadonly<VehicleSeat>[] }[] {
  const { world, ctx, seat } = env;
  const held = colonyHeldShips(world, seat);
  const vehicles = contentIndex(ctx.content).vehicles;
  const stray: { ship: Entity; riders: DeepReadonly<VehicleSeat>[] }[] = [];
  for (const ship of vehicleIndex(world).ownedBy(seat)) {
    const state = world.get(ship, Vehicle);
    const type = vehicles.get(state.vehicleType);
    if (held.includes(ship) || type === undefined || !isShipVehicle(type)) continue;
    stray.push({ ship, riders: vehiclePassengers(state) });
  }
  return stray;
}

/**
 * Bring home the seat's ships lying crewless at the colony, a scout's whose helm died at sea among them: a
 * man of the colony takes each one to the home berth, where it lies free again once the seat's crews pass
 * sets him down. The colony's own ships pass, and so does a ship with no man of its land to spare.
 */
export function recoverStrayShips(env: ColonyEnv, colony: ColonyView): PlayerCommand[] {
  const { world, ctx } = env;
  const berth = colony.berth;
  if (berth === null) return [];
  const taken = new Set<Entity>();
  const commands: PlayerCommand[] = [];
  const people = colonists(env);
  const spareHand = (): Entity | undefined =>
    people.find((e) => !taken.has(e) && isAllocatableMan(world, ctx, e));
  for (const { ship, riders } of strayShips(env)) {
    if (riders.length > 0 || !mooredOn(env, ship, colony.land)) continue;
    const hand = spareHand();
    if (hand === undefined) continue;
    taken.add(hand);
    commands.push({ kind: 'attachToVehicle', entity: hand, vehicle: ship }, dock(ship, berth));
  }
  return commands;
}

/** Drop `landed` from every colony's people lists: a man set off at home is home's again, or neither home
 *  nor the colony he stands away from would post him. Only a change writes. */
function forgetLanded(env: SeatEnv, landed: ReadonlySet<Entity>): void {
  const { world, carrier } = env;
  const listed = world
    .get(carrier, ComputerColony)
    .colonies.some(
      (colony) => colony.people.some((e) => landed.has(e)) || colony.rest.some((e) => landed.has(e)),
    );
  if (!listed) return;
  for (const colony of world.mut(carrier, ComputerColony).colonies) {
    colony.people = colony.people.filter((e) => !landed.has(e));
    colony.rest = colony.rest.filter((e) => !landed.has(e));
  }
}

/**
 * The seat's civilians lying still inside a ship no colony holds go home to `berth` and step off there, the
 * ship free again, and home's: a stray ship's helm, or a let-go route's trader and helpers. A trader among
 * them steps off a civilian, as the route that made him one is gone. A landing's crews are soldiers, so a
 * ship with a fighter aboard passes. Run for the seat, so a ship that docks after its colony fell is still
 * freed.
 */
export function strayCrewsHome(env: SeatEnv, berth: DeepReadonly<HalfCellNode>): PlayerCommand[] {
  const { world, ctx } = env;
  const home = homeLandOf(env);
  const commands: PlayerCommand[] = [];
  const landed = new Set<Entity>();
  for (const { ship, riders } of strayShips(env)) {
    if (riders.length === 0 || !lyingStill(world, ship) || !riders.every((rider) => rider.inside)) continue;
    const jobs = riders.map((rider) => world.get(rider.entity, Settler).jobType);
    if (jobs.some((job) => isFighterJob(ctx.content, job))) continue;
    const mooring = mooringOf(world, ship);
    if (mooring === null || !mooredOn(env, ship, home)) {
      commands.push(dock(ship, berth));
      continue;
    }
    commands.push(unloadAt(ship, mooring));
    riders.forEach((rider, i) => {
      landed.add(rider.entity);
      if (isTraderJob(ctx.content, jobs[i] ?? null))
        commands.push({ kind: 'setJob', entity: rider.entity, jobType: CIVILIST_JOB });
    });
  }
  if (landed.size > 0) forgetLanded(env, landed);
  return commands;
}
