import {
  clearInfoLine,
  type InfoLine,
  infoLinePlayers,
  isInfoLineIndex,
  setInfoLine,
} from '../../../components/index.js';
import type { MissionPass } from '../pass.js';
import type { MissionResultOp } from '../script.js';

type InfoOp = Extract<
  MissionResultOp,
  {
    opcode:
      | 'InfoClear'
      | 'InfoShowString'
      | 'InfoCountGoodsInArea'
      | 'InfoCountHousesInArea'
      | 'InfoCountHumenInArea'
      | 'InfoCountSoldiersInArea'
      | 'InfoCountAnimalsInArea';
  }
>;

/** Clear or set one of a player's on-screen info lines, or every player's for a broadcast; the
 *  counting kinds record what to tally and the app reads the tally live. */
export function scriptInfoLine(pass: MissionPass, mission: number, op: InfoOp): void {
  const players = infoLinePlayers(op.player);
  if (players.length === 0 || !isInfoLineIndex(op.index)) {
    pass.reportFailed(mission, op.opcode);
    return;
  }
  if (op.opcode === 'InfoClear') {
    for (const player of players) clearInfoLine(pass.world, player, op.index);
    return;
  }
  const line = infoLineOf(op);
  for (const player of players) setInfoLine(pass.world, player, op.index, line);
}

function infoLineOf(op: Exclude<InfoOp, { opcode: 'InfoClear' }>): InfoLine {
  switch (op.opcode) {
    case 'InfoShowString':
      return { kind: 'text', stringId: op.stringId, target: 0, point: { hx: 0, hy: 0 }, range: 0, extra: 0 };
    case 'InfoCountGoodsInArea':
      return counting('goods', op, op.good);
    case 'InfoCountHousesInArea':
      return counting('houses', op, op.houseType);
    case 'InfoCountHumenInArea':
      return counting('humans', op, 0);
    case 'InfoCountSoldiersInArea':
      return counting('soldiers', op, 0);
    case 'InfoCountAnimalsInArea':
      return counting('animals', op, op.tribe);
  }
}

function counting(
  kind: Exclude<InfoLine['kind'], 'text'>,
  op: { stringId: number; point: { hx: number; hy: number }; range: number; extra: number },
  target: number,
): InfoLine {
  return { kind, stringId: op.stringId, target, point: { ...op.point }, range: op.range, extra: op.extra };
}
