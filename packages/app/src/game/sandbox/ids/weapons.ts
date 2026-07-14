import {
  GOOD_BOW_LONG,
  GOOD_BOW_SHORT,
  GOOD_SPEAR_IRON,
  GOOD_SWORD_LONG,
  GOOD_SWORD_SHORT,
} from './economy/goods.js';
import {
  JOB_ARCHER,
  JOB_ARCHER_LONG,
  JOB_SOLDIER_BROADSWORD,
  JOB_SOLDIER_SPEAR,
  JOB_SOLDIER_SWORD,
} from './economy/jobs.js';

// Weapon typeIds ride the real viking `weapons.ini` ids.
export const WEAPON_FISTS = 1;
export const WEAPON_SPEAR = 5;
export const WEAPON_SWORD = 7;
export const WEAPON_BROADSWORD = 8;
export const WEAPON_SHORT_BOW = 16;
export const WEAPON_LONG_BOW = 17;

/** Soldier `jobType` → the weapon good carried in its `Equipment.weapon` slot. */
export const WEAPON_GOOD_BY_JOB: Readonly<Record<number, number>> = {
  [JOB_SOLDIER_SPEAR]: GOOD_SPEAR_IRON,
  [JOB_SOLDIER_SWORD]: GOOD_SWORD_SHORT,
  [JOB_SOLDIER_BROADSWORD]: GOOD_SWORD_LONG,
  [JOB_ARCHER]: GOOD_BOW_SHORT,
  [JOB_ARCHER_LONG]: GOOD_BOW_LONG,
};

/** The `spawnSettler` equipment payload for a soldier job, or `undefined` for an unarmed/civilian job. */
export function weaponEquipmentFor(
  jobType: number,
): { readonly weapon: { readonly goodType: number } } | undefined {
  const goodType = WEAPON_GOOD_BY_JOB[jobType];
  return goodType !== undefined ? { weapon: { goodType } } : undefined;
}
