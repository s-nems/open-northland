import type { AtomicAnimation, ContentSet } from '@open-northland/data';
import type { SettlerIdentity } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import { attackerWeapon } from '../conflict/weapons.js';
import {
  ATOMIC_EVENT_TYPE_CHANGE_GOLD,
  ATOMIC_EVENT_TYPE_GET_TRAINING,
  atomicClip,
} from '../readviews/animations.js';
import { isSoldierJob, weaponClassOf } from '../readviews/index.js';
import { BARRACKS_TERM_TICKS } from '../settlers/drives/barracks-term.js';
import { personalFightPoints } from './bonus.js';
import { FIGHT_EXPERIENCE_TYPE, fightExperienceTypeFor } from './experience.js';

/**
 * The coin drill's rules, shared by the player order and the HUD. Original behavior,
 * unconfirmed against the running original: the soldier's `..._soldier_train` clip takes one coin and grants
 * 25 training points per playthrough. Our rule: the clip's coins pay one {@link COIN_DRILL_TERM_TICKS} term,
 * taken when the term starts; he repeats the clip inside until the term is served, and its points land
 * when it ends. A soldier drills only below {@link COIN_DRILL_LIMIT}.
 */

/** What the clip's coins buy: one barracks term, the recruit's enlistment length on purpose. */
export const COIN_DRILL_TERM_TICKS = BARRACKS_TERM_TICKS;

/** The soldier's train action, bound `setatomic 31 90 "..._soldier_train"` for the bare soldier in every
 *  playable tribe. */
export const COIN_DRILL_ATOMIC_ID = 90;

/** The personal fight points from which a soldier may no longer drill: at 49 one more term is
 *  allowed. Our rule. */
export const COIN_DRILL_LIMIT = 50;

/** The good the clip's `CHANGE_GOLD` event spends from the barracks' stock. Our rule: the event names no
 *  good, and the barracks shelves coins for it. */
export const DRILL_COIN_GOOD_SLUG = 'coin';

/** The content good id of the drill coin, or undefined when content has none. */
export function drillCoinGood(content: ContentSet): number | undefined {
  return contentIndex(content).goodTypeBySlug.get(DRILL_COIN_GOOD_SLUG);
}

/**
 * Whether `settler` drills as a soldier: any man in a soldier trade, armed or bare-handed, so a soldier is a
 * soldier. `weaponTypeId` is his worn `Weapon`, else his class default; a catapult crew's weapon trains the
 * catapult's own bucket, so he never drills. Heroes and civilians hold no soldier trade. Our rule.
 */
function drillsAsSoldier(
  content: ContentSet,
  settler: SettlerIdentity,
  weaponTypeId: number | undefined,
): boolean {
  if (!isSoldierJob(content, settler.jobType)) return false;
  const armed = attackerWeapon({ content }, settler.tribe, settler.jobType, weaponTypeId, settler.humanForm);
  const mainType = armed === null ? undefined : weaponClassOf(armed.weapon);
  return mainType === undefined || fightExperienceTypeFor(mainType) !== FIGHT_EXPERIENCE_TYPE.CATAPULT;
}

/**
 * The clip a soldier plays for a coin-drill repetition: his own trade's binding, else his `baseJob`'s, the
 * bare soldier who alone binds it. Approximation: the original resolves an armed soldier's actions through
 * his `baseatomics` parent, flattened here to the one step this clip needs.
 */
export function coinDrillClip(content: ContentSet, settler: SettlerIdentity): AtomicAnimation | undefined {
  const own = atomicClip(content, settler, COIN_DRILL_ATOMIC_ID);
  if (own !== undefined || settler.jobType === null) return own;
  const baseJob = contentIndex(content).jobs.get(settler.jobType)?.baseJob;
  if (baseJob === undefined || baseJob === settler.jobType) return undefined;
  return atomicClip(content, { ...settler, jobType: baseJob }, COIN_DRILL_ATOMIC_ID);
}

/** The fight points a term drilled on `clip` grants: the sum of its `GET_TRAINING` values. */
export function coinDrillPointsOf(clip: AtomicAnimation): number {
  let points = 0;
  for (const event of clip.events)
    if (event.type === ATOMIC_EVENT_TYPE_GET_TRAINING) points += event.value ?? 0;
  return Math.max(0, points);
}

/** The coins a term drilled on `clip` spends: the negated sum of its `CHANGE_GOLD` values. */
export function coinDrillCoinsOf(clip: AtomicAnimation): number {
  let coins = 0;
  for (const event of clip.events)
    if (event.type === ATOMIC_EVENT_TYPE_CHANGE_GOLD) coins -= event.value ?? 0;
  return Math.max(0, coins);
}

/**
 * Whether a soldier may start another coin-drill term, from his plain state alone: a soldier, armed or
 * bare, below {@link COIN_DRILL_LIMIT} on his personal counter, with a clip that spends a coin. The
 * world gate (`orders/coin-drill.ts`) adds the barracks and the walk; a HUD reads the same fields off a
 * snapshot.
 */
export function mayCoinDrill(
  content: ContentSet,
  settler: SettlerIdentity,
  weaponTypeId: number | undefined,
  experience: ReadonlyMap<number, number>,
): boolean {
  if (!drillsAsSoldier(content, settler, weaponTypeId)) return false;
  if (personalFightPoints(experience) >= COIN_DRILL_LIMIT) return false;
  const clip = coinDrillClip(content, settler);
  return clip !== undefined && coinDrillCoinsOf(clip) > 0;
}
