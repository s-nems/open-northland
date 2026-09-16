import { Chest, Position } from '../../../components/index.js';
import { hexDistance, nodeOfPosition } from '../../../nav/halfcell.js';
import type { MissionPass } from '../pass.js';
import type { MissionGoalOp } from '../script.js';

/** `ChestNearPos`: only a still-closed chest counts; an opened chest has transitioned to void logic. */
export function chestNearPoint(
  pass: MissionPass,
  op: Extract<MissionGoalOp, { opcode: 'ChestNearPos' }>,
): boolean {
  if (op.range < 0) return false;
  for (const entity of pass.world.query(Chest, Position)) {
    const position = pass.world.get(entity, Position);
    if (hexDistance(nodeOfPosition(position.x, position.y), op.point) <= op.range) return true;
  }
  return false;
}
