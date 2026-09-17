import { playerTally } from '../../../components/index.js';
import type { World } from '../../../ecs/world.js';
import { vehicleIndex } from '../../vehicles/registry.js';
import { missionObjects } from '../object-index.js';
import { isMissionAnimal, isMissionHouse, isMissionHuman } from '../targets.js';

/** Holds once nothing stamped with the id is left standing. The goals differ only in what they look
 *  for, since houses and animals share one object-id kind. */
export function humansGone(world: World, id: number): boolean {
  return !missionObjects(world, id).some((e) => isMissionHuman(world, e));
}

export function housesGone(world: World, id: number): boolean {
  return !missionObjects(world, id).some((e) => isMissionHouse(world, e));
}

export function animalsGone(world: World, id: number): boolean {
  return !missionObjects(world, id).some((e) => isMissionAnimal(world, e));
}

export function vehiclesGone(world: World, id: number): boolean {
  return vehicleIndex(world).withMissionId(id).length === 0;
}

export function humansDiedHolds(world: World, player: number, amount: number): boolean {
  return playerTally(world, player).humansDied >= amount;
}

export function soldiersDiedHolds(world: World, player: number, amount: number): boolean {
  return playerTally(world, player).soldiersDied >= amount;
}

export function humansKilledHolds(world: World, player: number, amount: number): boolean {
  return playerTally(world, player).humansKilled >= amount;
}
