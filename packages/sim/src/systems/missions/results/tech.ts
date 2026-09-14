import { houseDiscoveryGoods } from '@open-northland/data';
import { grantScriptUnlock } from '../../../components/index.js';
import { assertNever } from '../../../core/brand.js';
import type { MissionPass } from '../pass.js';
import type { MissionResultOp } from '../script.js';

type UnlockOp = Extract<
  MissionResultOp,
  { opcode: 'AllowJob' | 'EnableJob' | 'AllowHouse' | 'EnableHouse' | 'AllowGood' | 'EnableGood' }
>;

export function grantUnlock(pass: MissionPass, op: UnlockOp): void {
  const { world } = pass;
  switch (op.opcode) {
    case 'AllowJob':
      grantScriptUnlock(world, 'allowed', op.player, op.tribe, 'job', op.job);
      return;
    case 'EnableJob':
      grantScriptUnlock(world, 'enabled', op.player, op.tribe, 'job', op.job);
      return;
    case 'AllowHouse':
      grantScriptUnlock(world, 'allowed', op.player, op.tribe, 'house', op.houseType);
      return;
    case 'EnableHouse':
      grantScriptUnlock(world, 'enabled', op.player, op.tribe, 'house', op.houseType);
      for (const good of houseDiscoveryGoods(pass.ctx.content, op.houseType))
        grantScriptUnlock(world, 'enabled', op.player, op.tribe, 'good', good);
      return;
    case 'AllowGood':
      grantScriptUnlock(world, 'allowed', op.player, op.tribe, 'good', op.good);
      return;
    case 'EnableGood':
      grantScriptUnlock(world, 'enabled', op.player, op.tribe, 'good', op.good);
      return;
    default:
      assertNever(op);
  }
}
