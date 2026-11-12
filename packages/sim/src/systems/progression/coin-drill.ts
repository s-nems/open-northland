import type { AtomicAnimation, ContentSet } from '@open-northland/data';
import { COIN_DRILL_CLASSES, type CoinDrillClass, type SettlerIdentity } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import { attackerWeapon } from '../conflict/weapons.js';
import {
  ATOMIC_EVENT_TYPE_CHANGE_GOLD,
  ATOMIC_EVENT_TYPE_GET_TRAINING,
  atomicClip,
} from '../readviews/animations.js';
import { isSoldierJob, WEAPON_MAIN_TYPE, weaponClassOf } from '../readviews/index.js';
import { personalFightPoints } from './bonus.js';

/**
 * The coin drill's rules, shared by the player order, the assistant and the HUD. Original behavior,
 * unconfirmed against the running original: the soldier's `..._soldier_train` clip takes one coin and grants
 * 25 training points per playthrough. Our rule: one coin pays one whole clip, and a soldier drills only
 * below {@link COIN_DRILL_LIMIT}.
 */

/** The soldier's train action, bound `setatomic 31 90 "..._soldier_train"` for the bare soldier in every
 *  playable tribe. */
export const COIN_DRILL_ATOMIC_ID = 90;

/** The personal fight points from which a soldier may no longer drill: at 49 one more repetition is
 *  allowed. Our rule. */
export const COIN_DRILL_LIMIT = 50;

/** The good the clip's `CHANGE_GOLD` event spends from the barracks' stock. Our rule: the event names no
 *  good, and the barracks shelves coins for it. */
export const DRILL_COIN_GOOD_SLUG = 'coin';

/** The weapon class (`maintype`) each coin-drill class fights with. A saber or an axe is none of them. */
export const COIN_DRILL_CLASS_WEAPON: Readonly<Record<CoinDrillClass, number>> = {
  sword: WEAPON_MAIN_TYPE.SWORD,
  spear: WEAPON_MAIN_TYPE.SPEAR,
  bow: WEAPON_MAIN_TYPE.BOW,
};

/** The content good id of the drill coin, or undefined when content has none. */
export function drillCoinGood(content: ContentSet): number | undefined {
  return contentIndex(content).goodTypeBySlug.get(DRILL_COIN_GOOD_SLUG);
}

/**
 * The coin-drill class of a soldier with `settler`'s identity holding `weaponTypeId` (his worn
 * `Weapon`, else his class default), or null for anyone else: a hero, a civilian, a catapult crew or a
 * bare-handed soldier.
 */
export function coinDrillClassOf(
  content: ContentSet,
  settler: SettlerIdentity,
  weaponTypeId: number | undefined,
): CoinDrillClass | null {
  if (!isSoldierJob(content, settler.jobType)) return null;
  const armed = attackerWeapon({ content }, settler.tribe, settler.jobType, weaponTypeId, settler.humanForm);
  if (armed === null) return null;
  const mainType = weaponClassOf(armed.weapon);
  for (const drillClass of COIN_DRILL_CLASSES) {
    if (COIN_DRILL_CLASS_WEAPON[drillClass] === mainType) return drillClass;
  }
  return null;
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

/** The fight points one repetition of `clip` grants: the sum of its `GET_TRAINING` values. */
export function coinDrillPointsOf(clip: AtomicAnimation): number {
  let points = 0;
  for (const event of clip.events)
    if (event.type === ATOMIC_EVENT_TYPE_GET_TRAINING) points += event.value ?? 0;
  return Math.max(0, points);
}

/** The coins one repetition of `clip` spends: the negated sum of its `CHANGE_GOLD` values. */
export function coinDrillCoinsOf(clip: AtomicAnimation): number {
  let coins = 0;
  for (const event of clip.events)
    if (event.type === ATOMIC_EVENT_TYPE_CHANGE_GOLD) coins -= event.value ?? 0;
  return Math.max(0, coins);
}

/** The fight points a soldier with `settler`'s identity gains per repetition, 0 when no clip binds. */
export function coinDrillPointsPerCoin(content: ContentSet, settler: SettlerIdentity): number {
  const clip = coinDrillClip(content, settler);
  return clip === undefined ? 0 : coinDrillPointsOf(clip);
}

/**
 * Whether a soldier may run another coin-drill repetition, from his plain state alone: a sword, spear or
 * bow class, below {@link COIN_DRILL_LIMIT} on his personal counter, with a clip that spends a coin. The
 * world gate (`orders/coin-drill.ts`) adds the barracks and the walk; a HUD reads the same fields off a
 * snapshot.
 */
export function mayCoinDrill(
  content: ContentSet,
  settler: SettlerIdentity,
  weaponTypeId: number | undefined,
  experience: ReadonlyMap<number, number>,
): boolean {
  if (coinDrillClassOf(content, settler, weaponTypeId) === null) return false;
  if (personalFightPoints(experience) >= COIN_DRILL_LIMIT) return false;
  const clip = coinDrillClip(content, settler);
  return clip !== undefined && coinDrillCoinsOf(clip) > 0;
}
