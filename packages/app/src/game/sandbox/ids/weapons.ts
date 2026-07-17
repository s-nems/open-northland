import {
  GOOD_BOW_LONG,
  GOOD_BOW_SHORT,
  GOOD_SPEAR_IRON,
  GOOD_SPEAR_WOODEN,
  GOOD_SWORD_LONG,
  GOOD_SWORD_SHORT,
} from './economy/goods.js';
import {
  JOB_ARCHER,
  JOB_ARCHER_LONG,
  JOB_HERO_AXE,
  JOB_HERO_SABER,
  JOB_HERO_SPEAR,
  JOB_HERO_SWORD,
  JOB_HEROINE_BOW,
  JOB_SOLDIER_AXE_BIG,
  JOB_SOLDIER_AXE_SMALL,
  JOB_SOLDIER_BROADSWORD,
  JOB_SOLDIER_SABER_LONG,
  JOB_SOLDIER_SABER_SHORT,
  JOB_SOLDIER_SPEAR,
  JOB_SOLDIER_SPEAR_WOODEN,
  JOB_SOLDIER_SWORD,
} from './economy/jobs.js';

// Weapon typeIds ride the real viking `weapons.ini` ids.
export const WEAPON_FISTS = 1;
export const WEAPON_SPEAR = 5;
export const WEAPON_SWORD = 7;
export const WEAPON_BROADSWORD = 8;
export const WEAPON_SHORT_BOW = 16;
export const WEAPON_LONG_BOW = 17;

/**
 * Soldier/hero `jobType` → the weapon good carried in its `Equipment.weapon` slot, matching the body
 * the render draws for that class (`ADULT_CHARACTER_BY_JOB`). There are no saber or axe weapon goods
 * in `goodtypes.ini`, so those classes carry the sword good whose body they already borrow — a named
 * approximation keeping the panel's Broń row consistent with the drawn weapon.
 */
export const WEAPON_GOOD_BY_JOB: Readonly<Record<number, number>> = {
  [JOB_SOLDIER_SPEAR_WOODEN]: GOOD_SPEAR_WOODEN,
  [JOB_SOLDIER_SPEAR]: GOOD_SPEAR_IRON,
  [JOB_SOLDIER_SWORD]: GOOD_SWORD_SHORT,
  [JOB_SOLDIER_BROADSWORD]: GOOD_SWORD_LONG,
  [JOB_SOLDIER_SABER_SHORT]: GOOD_SWORD_SHORT,
  [JOB_SOLDIER_SABER_LONG]: GOOD_SWORD_LONG,
  [JOB_SOLDIER_AXE_SMALL]: GOOD_SWORD_LONG,
  [JOB_SOLDIER_AXE_BIG]: GOOD_SWORD_LONG,
  [JOB_ARCHER]: GOOD_BOW_SHORT,
  [JOB_ARCHER_LONG]: GOOD_BOW_LONG,
  [JOB_HERO_SPEAR]: GOOD_SPEAR_IRON,
  [JOB_HERO_SWORD]: GOOD_SWORD_SHORT,
  [JOB_HERO_SABER]: GOOD_SWORD_SHORT,
  [JOB_HERO_AXE]: GOOD_SWORD_LONG,
  [JOB_HEROINE_BOW]: GOOD_BOW_LONG,
};

/** The `spawnSettler` equipment payload for a soldier job, or `undefined` for an unarmed/civilian job. */
export function weaponEquipmentFor(
  jobType: number,
): { readonly weapon: { readonly goodType: number } } | undefined {
  const goodType = WEAPON_GOOD_BY_JOB[jobType];
  return goodType !== undefined ? { weapon: { goodType } } : undefined;
}
