import { systems } from '@open-northland/sim';
import type { Messages } from '../i18n/index.js';

export type WeaponXpKey = keyof Messages['hud']['weaponXp'];

/** The fight experience buckets, which have no content row, by experience type: the catalog key naming each. */
export const WEAPON_XP_KEY_BY_TYPE: ReadonlyMap<number, WeaponXpKey> = new Map<number, WeaponXpKey>([
  [systems.FIGHT_EXPERIENCE_TYPE.FIST, 'fist'],
  [systems.FIGHT_EXPERIENCE_TYPE.SPEAR, 'spear'],
  [systems.FIGHT_EXPERIENCE_TYPE.SWORD, 'sword'],
  [systems.FIGHT_EXPERIENCE_TYPE.BOW, 'bow'],
  [systems.FIGHT_EXPERIENCE_TYPE.CATAPULT, 'catapult'],
]);
