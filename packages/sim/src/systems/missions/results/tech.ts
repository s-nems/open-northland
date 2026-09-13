import { houseDiscoveryGoods } from '@open-northland/data';
import { grantScriptUnlock } from '../../../components/index.js';
import { assertNever } from '../../../core/brand.js';
import { contentIndex } from '../../../core/content-index.js';
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
    case 'EnableGood': {
      grantScriptUnlock(world, 'enabled', op.player, op.tribe, 'good', op.good);
      const producers = new Set(
        contentIndex(pass.ctx.content)
          .tribes.get(op.tribe)
          ?.jobEnables.filter((edge) => edge.kind === 'good' && edge.targetId === op.good)
          .map((edge) => edge.jobType),
      );
      if (producers.size === 1)
        for (const job of producers) grantScriptUnlock(world, 'enabled', op.player, op.tribe, 'job', job);
      return;
    }
    default:
      assertNever(op);
  }
}
