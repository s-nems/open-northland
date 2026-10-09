import type { TribeType, UnitVariant, WeaponType } from '@open-northland/data';
import { JOB_SOLDIER_SPEAR, JOB_SOLDIER_SPEAR_WOODEN } from './jobs.js';

/** Authored balance: CNMod's Byzantine dragon belongs only to non-claimable scenario seats.
 * Playable seats borrow the ordinary wooden weapon and the Byzantine human spear choreography.
 * Original behavior: the wooden-spear class has 20000 HP; its equipment transitions remain unconfirmed. */
export const BYZANTINE_SPEAR_VARIANTS: readonly UnitVariant[] = [
  {
    jobType: JOB_SOLDIER_SPEAR_WOODEN,
    scenario: false,
    hitpoints: 5000,
    weapon: { tribeType: 1, typeId: 4 },
    animationJobType: JOB_SOLDIER_SPEAR,
    graphicsJobType: JOB_SOLDIER_SPEAR,
    walkStepReduction: 0,
  },
  { jobType: JOB_SOLDIER_SPEAR_WOODEN, scenario: true, hitpoints: 20000 },
];

export function withUnitVariants(tribe: TribeType, weapons: readonly WeaponType[]): TribeType {
  const hasSourceSpear = weapons.some(
    (weapon) =>
      weapon.tribeType === tribe.typeId && weapon.typeId === 4 && weapon.jobType === JOB_SOLDIER_SPEAR_WOODEN,
  );
  return tribe.typeId === 3 && tribe.unitVariants === undefined && hasSourceSpear
    ? { ...tribe, unitVariants: BYZANTINE_SPEAR_VARIANTS.map((rule) => ({ ...rule })) }
    : tribe;
}
