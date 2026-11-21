import type { WeaponArrowBlock } from '@open-northland/data';
import { isWildlife, Settler, Weapon } from '../../../../../../components/index.js';
import type { Fixed } from '../../../../../../core/fixed.js';
import type { Entity, World } from '../../../../../../ecs/world.js';
import { attackerWeapon } from '../../../../../conflict/weapons.js';
import type { SystemContext } from '../../../../../context.js';
import { HIT_DIRECTION_BIN, hitDirectionBinOf } from './damage.js';

const PERCENT = 100;

/**
 * The block of the weapon person `victim` fights with, when it stops an arrow coming from `from`. Our
 * rule: the weapon row's `arrowBlock` chance is rolled for an arrow from the front or a side, never one
 * from behind. The roll is drawn only when a block is possible, so a fight without such a weapon keeps
 * its rng stream. The caller passes only arrows: a siege shot is never blocked.
 */
export function rolledArrowBlock(
  world: World,
  ctx: SystemContext,
  victim: Entity,
  from: { readonly x: Fixed; readonly y: Fixed } | undefined,
): WeaponArrowBlock | undefined {
  const settler = world.tryGet(victim, Settler);
  if (settler === undefined || isWildlife(world, victim)) return undefined;
  const worn = world.tryGet(victim, Weapon)?.weaponTypeId;
  const block = attackerWeapon(ctx, settler.tribe, settler.jobType, worn)?.weapon.arrowBlock;
  if (block === undefined) return undefined;
  if (hitDirectionBinOf(world, victim, from) === HIT_DIRECTION_BIN.BEHIND) return undefined;
  return ctx.rng.int(PERCENT) < block.chancePct ? block : undefined;
}
