import {
  FOG_MODE,
  fogMode,
  isValidPlayer,
  markScriptVerdict,
  setAiExternalFlag,
  setDiplomacyLock,
  setDiplomacyStance,
} from '../../../components/index.js';
import type { MissionPass } from '../pass.js';
import type { MissionResultOp } from '../script.js';

/** Set one direction of a pair's stance, through any lock on the pair. */
export function setScriptedStance(
  pass: MissionPass,
  mission: number,
  op: Extract<MissionResultOp, { opcode: 'SetDiplomacy' }>,
): void {
  if (op.state === undefined || !isValidPlayer(op.player) || !isValidPlayer(op.otherPlayer)) {
    pass.reportFailed(mission, op.opcode);
    return;
  }
  setDiplomacyStance(pass.world, op.player, op.otherPlayer, op.state);
}

export function lockScriptedStance(
  pass: MissionPass,
  mission: number,
  op: Extract<MissionResultOp, { opcode: 'SetDiplomacyNotChangeableFlag' }>,
): void {
  if (!isValidPlayer(op.player) || !isValidPlayer(op.otherPlayer)) {
    pass.reportFailed(mission, op.opcode);
    return;
  }
  setDiplomacyLock(pass.world, op.player, op.otherPlayer, op.flag);
}

/** Declare the map won or lost for the player and announce it the way the match rule does. A repeat
 *  fire announces again, as the original re-sends its message; the verdict is recorded once. */
export function declareScriptedVerdict(
  pass: MissionPass,
  mission: number,
  op: Extract<MissionResultOp, { opcode: 'MissionWon' | 'MissionFailed' }>,
): void {
  if (!isValidPlayer(op.player)) {
    pass.reportFailed(mission, op.opcode);
    return;
  }
  const won = op.opcode === 'MissionWon';
  markScriptVerdict(pass.world, op.player, won ? 'won' : 'lost');
  pass.ctx.events.emit({ kind: won ? 'playerWon' : 'playerDefeated', player: op.player });
}

/** Reveal the hexagon of `range` map points around the point, or the whole map for a zero x, y or
 *  range, as fully as ground the player's own eye covers, for good under REVEAL and RECON alike. Fog
 *  off shows everything already and holds no mask to write. */
export function exploreScriptedArea(
  pass: MissionPass,
  mission: number,
  op: Extract<MissionResultOp, { opcode: 'ExploreArea' }>,
): void {
  if (!isValidPlayer(op.player)) {
    pass.reportFailed(mission, op.opcode);
    return;
  }
  const fog = pass.ctx.fog;
  if (fog === undefined || fogMode(pass.world) === FOG_MODE.OFF) return;
  if (op.point.hx === 0 || op.point.hy === 0 || op.range === 0) fog.revealAll(op.player);
  else fog.revealArea(op.player, op.point, op.range);
}

/** Raise or clear one of the player's AI condition slots. */
export function setScriptedAiFlag(
  pass: MissionPass,
  mission: number,
  op: Extract<MissionResultOp, { opcode: 'SetExternalFlag' }>,
): void {
  if (!isValidPlayer(op.player)) {
    pass.reportFailed(mission, op.opcode);
    return;
  }
  setAiExternalFlag(pass.world, op.player, op.flagId, op.flag);
}
