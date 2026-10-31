// One blow, in the sim's order. The window reads these numbers from content and sim constants.
import { data, number, SECONDS_PER_TICK, seconds } from './model.js';

/** The target columns, keyed like a weapon's `damage` record. */
export const TARGETS = [
  { key: '0', name: 'Bez pancerza', person: true },
  { key: '1', name: 'Tunika', person: true, good: 'armor_wool' },
  { key: '2', name: 'Skórzana', person: true, good: 'armor_leather' },
  { key: '3', name: 'Kolczuga', person: true, good: 'armor_chain' },
  { key: '4', name: 'Płytowa', person: true, good: 'armor_plate' },
  { key: '6', name: 'Pojazd', person: false, vehicle: true },
  { key: '7', name: 'Budynek', person: false },
];
/** An animal takes the leather column with neither direction nor blocking. */
export const ANIMAL_TARGET = { key: '2', name: 'Zwierzę', person: false };
export const HUMAN_HITPOINTS = 5000;
export const BLOCKING_VALUE = 5;
export const CAP_HITS = 100;
export const STRENGTH_PERCENT = 150;
export const RANGED_MAIN_TYPES = new Set([6, 7]);
export const NO_MODIFIERS = { direction: 100, hits: 0, strength: false, defense: false };

/** Shots no amulet raises: a vehicle's and a building's. */
const NO_STRIKER = new Set(['catapult', 'house_bow']);

export const isRanged = (weapon) => RANGED_MAIN_TYPES.has(weapon.mainType);

/** The damage one blow lands: fight experience on a soldier's melee blow at anything but a vehicle, then
 *  for a person direction, blocking and the amulets; anything else takes only the striker's amulets. */
export function landed(weapon, target, m = NO_MODIFIERS) {
  const base = weapon.damage[target.key] ?? 0;
  const gains = !isRanged(weapon) && !target.vehicle && !weapon.id.startsWith('hero_');
  const raised = gains ? Math.trunc((base * 200) / (200 - Math.min(m.hits, CAP_HITS))) : base;
  const amulet = m.strength && !NO_STRIKER.has(weapon.id);
  const strong = (value) => (amulet ? Math.floor((value * STRENGTH_PERCENT) / 100) : value);
  if (!target.person) return Math.max(0, strong(raised));
  const directed = Math.trunc((raised * m.direction) / 100);
  const blocked = directed - (target.key === '0' ? 0 : BLOCKING_VALUE);
  const dealt = strong(blocked);
  return Math.max(0, m.defense ? Math.trunc(dealt / 2) : dealt);
}

export const hitsToKill = (damage, hitpoints = HUMAN_HITPOINTS) =>
  damage <= 0 ? null : Math.ceil(hitpoints / damage);

const clipSeconds = (weapon) => weapon.clipTicks * SECONDS_PER_TICK;

export const perSecond = (damage, weapon) =>
  weapon.clipTicks === null ? null : (damage * weapon.blows) / clipSeconds(weapon);

/** How long `hits` blows take; a clip lands all its blows. */
export const secondsForHits = (hits, weapon) =>
  weapon.clipTicks === null ? null : Math.ceil(hits / weapon.blows) * clipSeconds(weapon);

export const cadenceText = (weapon) => {
  if (weapon.clipTicks === null) return '-';
  const time = `${seconds(weapon.clipTicks)} s`;
  if (weapon.blows === 1) return time;
  return `${weapon.blows} ${weapon.blows < 5 ? 'ciosy' : 'ciosów'} co ${time}`;
};

export const perSecondText = (damage, weapon) => {
  const value = perSecond(damage, weapon);
  return value === null ? '-' : number(Math.round(value));
};

/** A step's length with shoes on land: 2 ticks per roughness level at 2, plus 2 base, less the tribe's. */
const SHOD_LAND_STEP_TICKS = 6;
export const stepSeconds = (equipmentWeight, tribe) => {
  const reduction = data.tribes.find((t) => t.typeId === tribe).stepReduction;
  return (SHOD_LAND_STEP_TICKS - reduction + Math.floor(equipmentWeight / 2)) * SECONDS_PER_TICK;
};
