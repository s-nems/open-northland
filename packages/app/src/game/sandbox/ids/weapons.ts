import {
  JOB_ARCHER,
  JOB_ARCHER_LONG,
  JOB_HERO_AXE,
  JOB_HERO_SABER,
  JOB_HERO_SPEAR,
  JOB_HERO_SWORD,
  JOB_HEROINE_BOW,
  JOB_SOLDIER_BROADSWORD,
  JOB_SOLDIER_SABER_LONG,
  JOB_SOLDIER_SABER_SHORT,
  JOB_SOLDIER_SPEAR,
  JOB_SOLDIER_SPEAR_WOODEN,
  JOB_SOLDIER_SWORD,
} from '../../../catalog/jobs.js';

// Weapon typeIds ride the real viking `weapons.ini` ids.
export const WEAPON_FISTS = 1;
export const WEAPON_SPEAR = 5;
export const WEAPON_SWORD = 7;
export const WEAPON_BROADSWORD = 8;
export const WEAPON_SHORT_BOW = 16;
export const WEAPON_LONG_BOW = 17;
export const WEAPON_HUNTER_BOW = 19;
export const WEAPON_HOUSE_BOW = 20;
export const WEAPON_CATAPULT = 21;

/**
 * Soldier/hero `jobType` → the good id-slug carried in its `Equipment.weapon` slot. Slugs, not numeric
 * ids: the sandbox catalog carries the weapon goods at 137-142 while real content keeps the
 * `goodtypes.ini` 37-42. `sword_shord` is that file's slug verbatim, typo included. Sabers and heroes
 * carry the good whose drawn body they borrow, a named approximation; the axe jobs get none, since no
 * `weapons.ini` record arms them.
 */
export const WEAPON_GOOD_SLUG_BY_JOB: Readonly<Record<number, string>> = {
  [JOB_SOLDIER_SPEAR_WOODEN]: 'spear_wooden',
  [JOB_SOLDIER_SPEAR]: 'spear_iron',
  [JOB_SOLDIER_SWORD]: 'sword_shord',
  [JOB_SOLDIER_BROADSWORD]: 'sword_long',
  [JOB_SOLDIER_SABER_SHORT]: 'sword_shord',
  [JOB_SOLDIER_SABER_LONG]: 'sword_long',
  [JOB_ARCHER]: 'bow_short',
  [JOB_ARCHER_LONG]: 'bow_long',
  [JOB_HERO_SPEAR]: 'spear_iron',
  [JOB_HERO_SWORD]: 'sword_shord',
  [JOB_HERO_SABER]: 'sword_long',
  [JOB_HERO_AXE]: 'sword_long',
  [JOB_HEROINE_BOW]: 'bow_long',
};

/** The running content's goods rows a weapon-good slug resolves against. */
export type WeaponGoodLookup = readonly { readonly typeId: number; readonly id: string }[];

/**
 * The `spawnSettler` equipment payload for a soldier/hero job, and `undefined` for a civilian job or a
 * content whose goods lack the slug.
 */
export function weaponEquipmentFor(
  jobType: number,
  goods: WeaponGoodLookup,
): { readonly weapon: { readonly goodType: number } } | undefined {
  const slug = WEAPON_GOOD_SLUG_BY_JOB[jobType];
  if (slug === undefined) return undefined;
  const good = goods.find((g) => g.id === slug);
  return good !== undefined ? { weapon: { goodType: good.typeId } } : undefined;
}
