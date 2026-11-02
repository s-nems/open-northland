import type { TribeType, UnitVariant, WeaponType } from '@open-northland/data';
import { VIKING } from './buildings.js';
import { JOB_SOLDIER_SPEAR, JOB_SOLDIER_SPEAR_WOODEN } from './jobs.js';

export const BYZANTINE = 3;
/** The `[weapontype]` id both peoples give their wooden spear. */
const WOODEN_SPEAR_WEAPON = 4;

/**
 * Authored balance: CNMod's Byzantine wooden spearman is a dragon, the class's native form, which the map
 * places and a script spawns. A trained one takes the human form: the ordinary wooden weapon and the
 * Byzantine iron spearman's choreography and look (`lifecycle/unit-form.ts` in the sim says when each
 * applies).
 * Original behavior: the dragon class has 20000 HP; its equipment transitions remain unconfirmed.
 */
export const BYZANTINE_SPEAR_VARIANTS: readonly UnitVariant[] = [
  {
    jobType: JOB_SOLDIER_SPEAR_WOODEN,
    form: 'human',
    hitpoints: 5000,
    weapon: { tribeType: VIKING, typeId: WOODEN_SPEAR_WEAPON },
    animationJobType: JOB_SOLDIER_SPEAR,
    graphicsJobType: JOB_SOLDIER_SPEAR,
  },
  { jobType: JOB_SOLDIER_SPEAR_WOODEN, form: 'native', hitpoints: 20000 },
];

export function withUnitVariants(tribe: TribeType, weapons: readonly WeaponType[]): TribeType {
  const hasSourceSpear = weapons.some(
    (weapon) =>
      weapon.tribeType === tribe.typeId &&
      weapon.typeId === WOODEN_SPEAR_WEAPON &&
      weapon.jobType === JOB_SOLDIER_SPEAR_WOODEN,
  );
  return tribe.typeId === BYZANTINE && tribe.unitVariants === undefined && hasSourceSpear
    ? { ...tribe, unitVariants: BYZANTINE_SPEAR_VARIANTS.map((rule) => ({ ...rule })) }
    : tribe;
}
