import { DEFAULT_NODE_ROUGHNESS, systems } from '@open-northland/sim';
import { EQUIP_CLASS_BY_SLUG } from '../../game/sandbox/combat.js';
import { type Messages, messages } from '../../i18n/index.js';
import { type KnowledgeBase, type KnowledgeGood, type KnowledgeWeapon, SECONDS_PER_TICK } from './base.js';

const PERCENT = 100;
const { ARMOR_MATERIAL, WEAPON_MAIN_TYPE } = systems;

export const HUMAN_HITPOINTS = systems.HUMAN_HITPOINTS;
export const CAP_HITS = systems.FIGHT_EXPERIENCE_DAMAGE_CAP_HITS;

/** Percent a blow lands with by where it comes from. */
export const HIT_DIRECTION = {
  front: PERCENT,
  backSide: systems.BACK_SIDE_HIT_PCT,
  behind: systems.BEHIND_HIT_PCT,
} as const;

export const STRENGTH_PCT = EQUIP_CLASS_BY_SLUG.get('amulet_strength')?.damageDealtPct ?? PERCENT;
const DEFENSE_TAKEN_PCT = EQUIP_CLASS_BY_SLUG.get('amulet_defense')?.damageTakenPct ?? PERCENT;
const CRITICAL_HIT = EQUIP_CLASS_BY_SLUG.get('amulet_crithit')?.criticalHit;

export type TargetId = keyof Messages['knowledge']['targets'];

/** What a blow lands on: `column` keys the weapon's `damage` record. */
export interface CombatTarget {
  readonly id: TargetId;
  readonly column: string;
  readonly person: boolean;
  readonly vehicle: boolean;
  /** The armour good a person target wears, by id. */
  readonly good: string | null;
  readonly blocking: number;
}

/** The fields of a weapon row a blow reads; an animal's attack passes for one. */
export type StrikingWeapon = Pick<KnowledgeWeapon, 'damage' | 'id' | 'mainType'>;

export interface BlowModifiers {
  /** A {@link HIT_DIRECTION} percent. */
  readonly direction: number;
  /** Hits landed with this weapon class. */
  readonly hits: number;
  readonly strength: boolean;
  readonly defense: boolean;
}

export const NO_MODIFIERS: BlowModifiers = {
  direction: HIT_DIRECTION.front,
  hits: 0,
  strength: false,
  defense: false,
};

/** Each person target's armour good, by the column its armour row names. */
const PERSON_TARGETS: readonly { id: TargetId; material: number; good: string }[] = [
  { id: 'wool', material: ARMOR_MATERIAL.WOOL, good: 'armor_wool' },
  { id: 'leather', material: ARMOR_MATERIAL.LEATHER, good: 'armor_leather' },
  { id: 'chain', material: ARMOR_MATERIAL.CHAIN, good: 'armor_chain' },
  { id: 'plate', material: ARMOR_MATERIAL.PLATE, good: 'armor_plate' },
];

/** An animal takes the leather column with neither direction nor blocking. */
export const ANIMAL_TARGET: CombatTarget = {
  id: 'animal',
  column: String(ARMOR_MATERIAL.LEATHER),
  person: false,
  vehicle: false,
  good: null,
  blocking: 0,
};

/** The target columns of a damage table, in reading order. */
export function combatTargets(base: KnowledgeBase): readonly CombatTarget[] {
  const blockingOf = (goodId: string): number => {
    const goodType = base.goodById.get(goodId)?.typeId;
    return base.armor.find((a) => a.goodType === goodType)?.blockingValue ?? 0;
  };
  return [
    {
      id: 'bare',
      column: String(ARMOR_MATERIAL.NONE),
      person: true,
      vehicle: false,
      good: null,
      blocking: 0,
    },
    ...PERSON_TARGETS.map(({ id, material, good }) => ({
      id,
      column: String(material),
      person: true,
      vehicle: false,
      good,
      blocking: blockingOf(good),
    })),
    {
      id: 'vehicle',
      column: String(ARMOR_MATERIAL.VEHICLE),
      person: false,
      vehicle: true,
      good: null,
      blocking: 0,
    },
    {
      id: 'building',
      column: String(ARMOR_MATERIAL.HOUSE),
      person: false,
      vehicle: false,
      good: null,
      blocking: 0,
    },
  ];
}

export function targetName(target: CombatTarget): string {
  return messages().knowledge.targets[target.id];
}

/** Shots no amulet raises: a vehicle's and a building's. */
const NO_STRIKER: ReadonlySet<string> = new Set(['catapult', 'house_bow']);
const HERO_WEAPON_PREFIX = 'hero_';

export function isHeroWeapon(weapon: Pick<KnowledgeWeapon, 'id'>): boolean {
  return weapon.id.startsWith(HERO_WEAPON_PREFIX);
}

/** Hero classes no map fields under a name of their own, so the reference leaves them out. */
const NAMELESS_HERO_WEAPONS: ReadonlySet<string> = new Set(['hero_axe', 'hero_fist']);

/** A hero a player can meet: one of the named ones. */
export function isNamedHeroWeapon(weapon: Pick<KnowledgeWeapon, 'id'>): boolean {
  return isHeroWeapon(weapon) && !NAMELESS_HERO_WEAPONS.has(weapon.id);
}

export function isCatapult(weapon: Pick<KnowledgeWeapon, 'mainType'>): boolean {
  return weapon.mainType === WEAPON_MAIN_TYPE.CATAPULT;
}

export function isRanged(weapon: Pick<KnowledgeWeapon, 'mainType'>): boolean {
  return weapon.mainType === WEAPON_MAIN_TYPE.BOW || weapon.mainType === WEAPON_MAIN_TYPE.CATAPULT;
}

export type BlowStepId = 'base' | 'block' | 'defense' | 'direction' | 'experience' | 'floor' | 'strength';

/** One step of a blow: `value` is the damage after it, `applies` says whether the rules run it here. */
export interface BlowStep {
  readonly id: BlowStepId;
  readonly value: number;
  readonly applies: boolean;
}

/** Whether a blow of `weapon` at `target` grows with its fighter's hits. */
export function gainsFightExperience(weapon: StrikingWeapon, target: CombatTarget): boolean {
  return !isRanged(weapon) && !target.vehicle && !isHeroWeapon(weapon);
}

/** Whether a fighter's Amulet of Strength raises `weapon`'s blows. */
export function takesStrengthAmulet(weapon: Pick<KnowledgeWeapon, 'id'>): boolean {
  return !NO_STRIKER.has(weapon.id);
}

/**
 * One blow in the sim's order: fight experience on a soldier's melee blow at anything but a vehicle, then
 * for a person direction, blocking and the amulets; anything else takes only the striker's amulets. A
 * blow never heals, so a last `floor` step stops the sum at zero.
 */
export function blowSteps(
  weapon: StrikingWeapon,
  target: CombatTarget,
  modifiers: BlowModifiers = NO_MODIFIERS,
): readonly BlowStep[] {
  const { person } = target;
  const base = weapon.damage[target.column] ?? 0;
  const raised = gainsFightExperience(weapon, target)
    ? systems.withFightExperience(base, modifiers.hits)
    : base;
  const directed = person ? Math.trunc((raised * modifiers.direction) / PERCENT) : raised;
  const blocked = person ? directed - target.blocking : directed;
  const amulet = modifiers.strength && takesStrengthAmulet(weapon);
  const strong = amulet ? Math.floor((blocked * STRENGTH_PCT) / PERCENT) : blocked;
  const shielded = person && modifiers.defense ? Math.trunc((strong * DEFENSE_TAKEN_PCT) / PERCENT) : strong;
  return [
    { id: 'base', value: base, applies: true },
    { id: 'experience', value: raised, applies: gainsFightExperience(weapon, target) },
    { id: 'direction', value: directed, applies: person },
    { id: 'block', value: blocked, applies: person },
    { id: 'strength', value: strong, applies: takesStrengthAmulet(weapon) },
    { id: 'defense', value: shielded, applies: person },
    { id: 'floor', value: Math.max(0, shielded), applies: shielded < 0 },
  ];
}

/** The damage one blow lands. */
export function landed(
  weapon: StrikingWeapon,
  target: CombatTarget,
  modifiers: BlowModifiers = NO_MODIFIERS,
): number {
  return blowSteps(weapon, target, modifiers).at(-1)?.value ?? 0;
}

/** Large enough that the sim's integer division leaves the percent exact. */
const EXPERIENCE_PROBE_DAMAGE = 10_000;

/** How many percent `hits` landed with a weapon class add to its blow. */
export function experienceBonusPct(hits: number): number {
  const raised = systems.withFightExperience(EXPERIENCE_PROBE_DAMAGE, hits);
  return Math.round((raised * PERCENT) / EXPERIENCE_PROBE_DAMAGE) - PERCENT;
}

/** The damage a critical hit raises `damage` to. */
export function criticalDamage(damage: number): number {
  return Math.floor((damage * (CRITICAL_HIT?.damagePct ?? PERCENT)) / PERCENT);
}

export const CRITICAL_CHANCE_PCT = CRITICAL_HIT?.chancePct ?? 0;

/** Blows to kill; null for a blow that does nothing. */
export function hitsToKill(damage: number, hitpoints: number = HUMAN_HITPOINTS): number | null {
  return damage <= 0 ? null : Math.ceil(hitpoints / damage);
}

/** One attack clip's length; null where no clip is bound. */
export function clipSeconds(weapon: Pick<KnowledgeWeapon, 'clipTicks'>): number | null {
  return weapon.clipTicks === null ? null : weapon.clipTicks * SECONDS_PER_TICK;
}

export function perSecond(damage: number, weapon: KnowledgeWeapon): number | null {
  const clip = clipSeconds(weapon);
  return clip === null ? null : (damage * weapon.blows) / clip;
}

/** How long `hits` blows take; a clip lands all its blows. */
export function secondsForHits(hits: number, weapon: KnowledgeWeapon): number | null {
  const clip = clipSeconds(weapon);
  return clip === null ? null : Math.ceil(hits / weapon.blows) * clip;
}

/** A step's length with shoes on common land under `equipmentWeight`. */
export function stepSeconds(equipmentWeight: number, shoes = true): number {
  const ticks = systems.walkStepTicks(DEFAULT_NODE_ROUGHNESS, {
    shoes,
    stepTicksSaved: 0,
    carrying: false,
    cartSpeedLossPercent: 0,
    tired: false,
    walksSlowly: false,
    walksFast: false,
    age: 'adult',
    equipmentWeight,
  });
  return ticks * SECONDS_PER_TICK;
}

export function weaponsOf(base: KnowledgeBase, tribe: number): readonly KnowledgeWeapon[] {
  return base.weapons.get(tribe) ?? [];
}

/** The row a soldier of `tribe` fights with `good`, else any row naming it. */
export function weaponOf(
  base: KnowledgeBase,
  good: KnowledgeGood,
  tribe: number,
): KnowledgeWeapon | undefined {
  const rows = weaponsOf(base, tribe).filter((w) => w.goodType === good.typeId);
  return rows.find((w) => w.usable && !isHeroWeapon(w)) ?? rows[0];
}

export function armourOf(base: KnowledgeBase, good: KnowledgeGood) {
  return base.armor.find((a) => a.goodType === good.typeId);
}

/** A tribe's craftable weapons, once each: heroes carry the same goods with rows of their own. */
export function shownWeapons(base: KnowledgeBase, tribe: number): readonly KnowledgeWeapon[] {
  return weaponsOf(base, tribe).filter((w) => w.usable && w.goodType !== null && !isHeroWeapon(w));
}
