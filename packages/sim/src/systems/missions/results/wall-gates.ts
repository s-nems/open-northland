import { playerGateAt, setPalisadeGate } from '../../palisades/index.js';
import type { MissionPass } from '../pass.js';
import type { MissionResultOp } from '../script.js';

type WallGateOp = Extract<MissionResultOp, { opcode: '1 Open/0 CloseWallGate' }>;

/**
 * Open or close the named player's gate at the point. The script reaches the same
 * {@link setPalisadeGate} transition a seat's own command does. A point with no gate of that player
 * is a silent no-op, as in the original; only a refused transition is reported.
 *
 * The original swaps the gate record unconditionally, so sharing the command path gives the
 * scripted close an occupancy refusal the original does not have: a mission that shuts a gate on a
 * passer-by leaves it open here and reports the failure.
 */
export function setScriptedWallGate(pass: MissionPass, mission: number, op: WallGateOp): void {
  const terrain = pass.ctx.terrain;
  if (terrain === undefined || !terrain.inBounds(op.point.hx, op.point.hy)) return;
  const gate = playerGateAt(pass.world, terrain, op.player, op.point.hx, op.point.hy);
  if (gate === null) return;
  if (!setPalisadeGate(pass.world, pass.ctx, { kind: 'setPalisadeGate', palisade: gate, open: op.flag })) {
    pass.reportFailed(mission, op.opcode);
  }
}
