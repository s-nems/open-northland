import { playerGateAt, setPalisadeGate } from '../../palisades/index.js';
import type { MissionPass } from '../pass.js';
import type { MissionResultOp } from '../script.js';

type WallGateOp = Extract<MissionResultOp, { opcode: '1 Open/0 CloseWallGate' }>;

/**
 * Open or close the named player's gate at the point. The script reaches the same
 * {@link setPalisadeGate} transition a seat's own command does; a missing, foreign or blocked gate is
 * reported rather than silently skipped.
 *
 * The original swaps the gate record unconditionally, so sharing the command path gives the
 * scripted close an occupancy refusal the original does not have: a mission that shuts a gate on a
 * passer-by leaves it open here and reports the failure.
 */
export function setScriptedWallGate(pass: MissionPass, mission: number, op: WallGateOp): void {
  const terrain = pass.ctx.terrain;
  if (terrain === undefined || !terrain.inBounds(op.point.hx, op.point.hy)) {
    pass.reportFailed(mission, op.opcode);
    return;
  }
  const gate = playerGateAt(pass.world, terrain, op.player, op.point.hx, op.point.hy);
  if (gate === null) {
    pass.reportFailed(mission, op.opcode);
    return;
  }
  if (!setPalisadeGate(pass.world, pass.ctx, { kind: 'setPalisadeGate', palisade: gate, open: op.flag })) {
    pass.reportFailed(mission, op.opcode);
  }
}
