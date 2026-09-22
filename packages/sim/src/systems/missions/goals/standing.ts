import { diplomacyStance, isPlayerDead, isValidPlayer, wasAttackedBy } from '../../../components/index.js';
import type { World } from '../../../ecs/world.js';
import { playerHasMet } from '../../vision/gates.js';
import type { MissionPass } from '../pass.js';
import type { MissionGoalOp } from '../script.js';

/** The player died under the match rule. A script's `MissionFailed` does not set this (reading). */
export function playerDiedHolds(world: World, player: number): boolean {
  return isPlayerDead(world, player);
}

/** The first player's stance toward the second is the named one. A line whose state token resolved
 *  to nothing, or names a slot the sim has no stance for, holds nowhere. */
export function diplomacyStateHolds(
  world: World,
  op: Extract<MissionGoalOp, { opcode: 'DiplomacyState' }>,
): boolean {
  if (op.state === undefined || !isValidPlayer(op.player) || !isValidPlayer(op.otherPlayer)) return false;
  return diplomacyStance(world, op.player, op.otherPlayer) === op.state;
}

/** The first player has seen the second: the vision system's first contact under fog, everyone in
 *  plain sight with fog off. */
export function playerSeenHolds(
  pass: MissionPass,
  op: Extract<MissionGoalOp, { opcode: 'PlayerSeen' }>,
): boolean {
  if (!isValidPlayer(op.player) || !isValidPlayer(op.otherPlayer)) return false;
  return playerHasMet(pass.world, pass.ctx.fog, op.player, op.otherPlayer);
}

/** The line's first token names the victim and its second the striker, the order the original
 *  binds them in. */
export function playerAttackedHolds(
  world: World,
  op: Extract<MissionGoalOp, { opcode: 'PlayerAttackedByPlayer' }>,
): boolean {
  const { otherPlayer: victim, player: striker } = op;
  return wasAttackedBy(world, victim, striker);
}
