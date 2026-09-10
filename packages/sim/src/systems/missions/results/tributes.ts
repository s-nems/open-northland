import { addTributeDemand, closeTribute, createTribute, isTributeSlot } from '../../../components/index.js';
import { assertNever } from '../../../core/brand.js';
import type { MissionPass } from '../pass.js';
import type { MissionResultOp } from '../script.js';

type TributeOp = Extract<MissionResultOp, { opcode: 'CreateTribute' | 'AddTributeGoods' | 'ClearTribute' }>;

/** Open, extend or close a tribute slot. A slot outside the table is reported, as is a sixth demanded
 *  good; a demand on a closed slot is skipped, as the original skips it. */
export function scriptTribute(pass: MissionPass, mission: number, op: TributeOp): void {
  if (!isTributeSlot(op.slot)) {
    pass.reportFailed(mission, op.opcode);
    return;
  }
  switch (op.opcode) {
    case 'CreateTribute':
      createTribute(pass.world, op.slot, op.player, op.otherPlayer, op.stringId);
      return;
    case 'AddTributeGoods':
      if (addTributeDemand(pass.world, op.slot, op.good, op.amount) === 'full') {
        pass.reportFailed(mission, op.opcode);
      }
      return;
    case 'ClearTribute':
      closeTribute(pass.world, op.slot);
      return;
    default:
      assertNever(op);
  }
}
