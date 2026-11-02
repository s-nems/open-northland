import { Settler, Vehicle, vehiclePassengers } from '../../../components/index.js';
import type { PlayerCommand } from '../../../core/commands/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity } from '../../../ecs/world.js';
import { colonyHeldShips } from '../../ai-shared/home-roster.js';
import { isAllocatableMan } from '../../ai-shared/workforce/pool.js';
import { isFighterJob } from '../../readviews/index.js';
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
  unloadAt,
} from './voyage.js';

/**
 * Bring home the seat's ships lying crewless at the colony, a scout's whose helm died at sea among them: a
 * man of the colony takes each one to the home berth and steps off there, where it lies free again. A
 * landing's crews are soldiers, so a civilian aboard a ship no colony holds is such a hand. The colony's own
 * ships pass, and so does a ship with no man of its land to spare.
 */
export function recoverStrayShips(env: ColonyEnv, colony: ColonyView): PlayerCommand[] {
  const { world, ctx, seat } = env;
  const berth = colony.berth;
  if (berth === null) return [];
  const held = colonyHeldShips(world, seat);
  const vehicles = contentIndex(ctx.content).vehicles;
  const home = homeLandOf(env);
  const taken = new Set<Entity>();
  const commands: PlayerCommand[] = [];
  const people = colonists(env);
  const spareHand = (): Entity | undefined =>
    people.find((e) => !taken.has(e) && isAllocatableMan(world, ctx, e));
  for (const ship of vehicleIndex(world).ownedBy(seat)) {
    const state = world.get(ship, Vehicle);
    const type = vehicles.get(state.vehicleType);
    if (held.includes(ship) || type === undefined || !isShipVehicle(type)) continue;
    const riders = vehiclePassengers(state);
    if (riders.length > 0) {
      const civilians = riders.every(
        (rider) => !isFighterJob(ctx.content, world.get(rider.entity, Settler).jobType),
      );
      if (!civilians || !lyingStill(world, ship) || !riders.every((rider) => rider.inside)) continue;
      const mooring = mooringOf(world, ship);
      if (mooring !== null && mooredOn(env, ship, home)) commands.push(unloadAt(ship, mooring));
      else commands.push(dock(ship, berth));
      continue;
    }
    if (!mooredOn(env, ship, colony.land)) continue;
    const hand = spareHand();
    if (hand === undefined) continue;
    taken.add(hand);
    commands.push({ kind: 'attachToVehicle', entity: hand, vehicle: ship }, dock(ship, berth));
  }
  return commands;
}
