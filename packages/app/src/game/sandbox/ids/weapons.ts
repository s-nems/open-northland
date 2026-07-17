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
} from './economy/jobs.js';

// Weapon typeIds ride the real viking `weapons.ini` ids.
export const WEAPON_FISTS = 1;
export const WEAPON_SPEAR = 5;
export const WEAPON_SWORD = 7;
export const WEAPON_BROADSWORD = 8;
export const WEAPON_SHORT_BOW = 16;
export const WEAPON_LONG_BOW = 17;

/**
 * Soldier/hero `jobType` → the good id-slug carried in its `Equipment.weapon` slot, matching the body
 * the render draws for that class. Slugs, not numeric good ids: the sandbox catalog carries the weapon
 * goods at +100 (137–142) while real content keeps the `goodtypes.ini` ids (37–42), so the spawn paths
 * resolve the slug against the running content ({@link weaponEquipmentFor}). `sword_shord` is the
 * extracted `goodtypes.ini` slug verbatim (its typo included).
 *
 * Sabers carry the sword good whose body they already borrow — no saber goods exist in `goodtypes.ini`
 * (a named approximation). Each hero follows the borrowed body of its `baseatomics` soldier class
 * (`jobtypes.ini`: 43→33, 44→34, 45→35, 46→39, 47→41) — a named approximation where a hero's own
 * `weapons.ini` record binds a different good (hero_sword binds 42, hero_axe 41); the equipped good
 * tracks the drawn body so the Broń row never contradicts the look. The axe jobs 38/39 get no
 * equipment good: no `weapons.ini` record binds them, so the sim cannot arm them — an equipment sword
 * would claim a weapon the unit doesn't actually swing.
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

/** The `(typeId, id-slug)` goods rows a weapon-good slug resolves against — the running content's
 *  goods table, in whichever id space the sim actually plays on (sandbox 137–142 or real 37–42). */
export type WeaponGoodLookup = readonly { readonly typeId: number; readonly id: string }[];

/**
 * The `spawnSettler` equipment payload for a soldier/hero job, or `undefined` for an unarmed/civilian
 * job — the one job→equipment-weapon seam every spawn path (scene placer, imported-map `sethuman`,
 * admin palette) shares. The slug resolves against `goods` ({@link WeaponGoodLookup}); a content
 * without the slug (a minimal fixture) yields `undefined` like a civilian.
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
