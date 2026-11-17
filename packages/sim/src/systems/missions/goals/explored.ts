import { isValidPlayer } from '../../../components/index.js';
import type { Entity } from '../../../ecs/world.js';
import { playerExploredNode } from '../../vision/gates.js';
import type { MissionPass } from '../pass.js';
import type { MissionGoalOp } from '../script.js';
import { missionAnimals, missionHouses, missionHumans, missionPoint } from '../targets.js';

/** The player has explored the point. The original keeps one explored bit per slot below 16 and
 *  holds for any higher slot outright; the fog masks answer per cell here. */
export function pointExploredHolds(
  pass: MissionPass,
  op: Extract<MissionGoalOp, { opcode: 'FindPos' }>,
): boolean {
  if (!isValidPlayer(op.player)) return true;
  return playerExploredNode(pass.ctx.fog, op.player, op.point.hx, op.point.hy);
}

/** Any human with the id stands on a point the player explored. */
export function humansExploredHolds(
  pass: MissionPass,
  op: Extract<MissionGoalOp, { opcode: 'FindHumans' }>,
): boolean {
  return anyOnExploredPoint(pass, op.player, missionHumans(pass.world, op.humanId));
}

export function housesExploredHolds(
  pass: MissionPass,
  op: Extract<MissionGoalOp, { opcode: 'FindHouses' }>,
): boolean {
  return anyOnExploredPoint(pass, op.player, missionHouses(pass.world, op.objectId));
}

export function animalsExploredHolds(
  pass: MissionPass,
  op: Extract<MissionGoalOp, { opcode: 'FindAnimals' }>,
): boolean {
  return anyOnExploredPoint(pass, op.player, missionAnimals(pass.world, op.objectId));
}

/** Nothing carrying the id holds nowhere, whatever the slot; the slot rule applies per entity. A human
 *  aboard counts where its carrier stands, as the original's human position ({@link missionPoint}), so a
 *  hero who boarded a ship is still found while the ship lies on ground the player explored - a map's
 *  `FindHumans` watchdog under a none-rule holds him lost the moment his own position went away. */
export function anyOnExploredPoint(pass: MissionPass, player: number, entities: readonly Entity[]): boolean {
  if (entities.length === 0) return false;
  if (!isValidPlayer(player)) return true;
  return entities.some((e) => {
    const at = missionPoint(pass.world, e);
    return at !== undefined && playerExploredNode(pass.ctx.fog, player, at.hx, at.hy);
  });
}
