import type { ContentSet } from '@open-northland/data';
import type { SettlerIdentity } from '../../components/index.js';
import { trueShotPct } from '../conflict/shot-aim.js';
import { attackerWeapon } from '../conflict/weapons.js';
import { isHeroJob, isRangedWeapon } from '../readviews/index.js';
import {
  fightUnitsWith,
  personalFightPoints,
  personalFightUnits,
  withDealtBonuses,
  withTakenBonuses,
} from './bonus.js';

/** What a person's personal fight counter buys him with the weapon he holds, in whole percent truncated,
 *  each read off the rule combat applies. */
export interface FightExperienceEffects {
  /** The raise on his blows; null when they draw on no experience: a shot, an unarmed man, or a class
   *  that trains none. */
  readonly dealtPct: number | null;
  /** The cut on every blow and shot that strikes him. */
  readonly takenCutPct: number;
  /** The share of his shots that fly true; null without a bow, or for a hero, who always shoots true. */
  readonly accuracyPct: number | null;
}

const PERCENT = 100;
/** A blow large enough that a raise or cut on it reads to a whole percent, truncated, rather than to the
 *  one-hitpoint step a 100 blow would show. */
const PROBE_BLOW = 10_000;

/** The whole percent `probed`, the probe blow after a rule, lies off it, truncated. */
function percentOff(probed: number): number {
  return Math.trunc((Math.abs(probed - PROBE_BLOW) * PERCENT) / PROBE_BLOW);
}

/** {@link FightExperienceEffects} of a person of `settler`'s identity wearing `wornWeaponTypeId`, with
 *  `experience` as his `SettlerProgress` holds it. */
export function fightExperienceEffects(
  content: ContentSet,
  settler: SettlerIdentity,
  wornWeaponTypeId: number | undefined,
  experience: ReadonlyMap<number, number>,
): FightExperienceEffects {
  const held = attackerWeapon(
    { content },
    settler.tribe,
    settler.jobType,
    wornWeaponTypeId,
    settler.humanForm === true,
  );
  const units = personalFightUnits(experience);
  const takenCutPct = percentOff(withTakenBonuses(PROBE_BLOW, units));
  if (held === null) return { dealtPct: null, takenCutPct, accuracyPct: null };
  if (isRangedWeapon(held.weapon)) {
    const aims = !isHeroJob(content, settler.jobType);
    const accuracyPct = aims ? trueShotPct(personalFightPoints(experience)) : null;
    return { dealtPct: null, takenCutPct, accuracyPct };
  }
  const dealtUnits = fightUnitsWith(experience, held.weapon.mainType);
  const dealtPct = dealtUnits === 0 ? null : percentOff(withDealtBonuses(PROBE_BLOW, dealtUnits));
  return { dealtPct, takenCutPct, accuracyPct: null };
}
