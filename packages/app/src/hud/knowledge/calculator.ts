import { messages } from '../../i18n/index.js';
import {
  buildingHitpoints,
  type KnowledgeBase,
  type KnowledgeBuilding,
  type KnowledgeWeapon,
  SECONDS_PER_TICK,
} from './base.js';
import {
  ANIMAL_TARGET,
  type BlowModifiers,
  type BlowStep,
  blowSteps,
  type CombatTarget,
  combatTargets,
  gainsFightExperience,
  HIT_DIRECTION,
  HUMAN_HITPOINTS,
  hitsToKill,
  isHeroWeapon,
  isNamedHeroWeapon,
  isRanged,
  perSecond,
  secondsForHits,
  takesStrengthAmulet,
  weaponsOf,
} from './combat.js';

export type CalculatorMode = 'blow' | 'duel';
export type TargetKind = 'animal' | 'building' | 'person' | 'vehicle';
export type ArmourId = 'bare' | 'chain' | 'leather' | 'plate' | 'wool';
export type WeaponGroupId = 'civilian' | 'hero' | 'soldier';

export const ARMOUR_IDS: readonly ArmourId[] = ['bare', 'wool', 'leather', 'chain', 'plate'];

/** Where a blow comes from, clockwise from the target's face. */
export const DIAL_SECTORS = [
  { id: 'front', direction: HIT_DIRECTION.front },
  { id: 'frontRight', direction: HIT_DIRECTION.front },
  { id: 'backRight', direction: HIT_DIRECTION.backSide },
  { id: 'back', direction: HIT_DIRECTION.behind },
  { id: 'backLeft', direction: HIT_DIRECTION.backSide },
  { id: 'frontLeft', direction: HIT_DIRECTION.front },
] as const;

export type DialSectorId = (typeof DIAL_SECTORS)[number]['id'];

export interface CalculatorAttacker {
  readonly tribe: number;
  readonly weapon: string;
  readonly hits: number;
  readonly strength: boolean;
  readonly sector: DialSectorId;
}

export interface CalculatorTarget {
  readonly kind: TargetKind;
  readonly armour: ArmourId;
  readonly defense: boolean;
  /** An animal's tribe id. */
  readonly animal: number;
  readonly building: string;
  /** The tribe whose house stands there: durability differs by tribe. */
  readonly buildingTribe: number;
  readonly vehicle: string;
  /** Health left; null is full. */
  readonly health: number | null;
}

/** One side of a duel. */
export interface DuelFighter {
  readonly tribe: number;
  readonly weapon: string;
  readonly hits: number;
  readonly strength: boolean;
  readonly armour: ArmourId;
  readonly defense: boolean;
}

export interface CalculatorState {
  /** The window's tribe this state was last set up for. */
  readonly homeTribe: number;
  readonly mode: CalculatorMode;
  readonly heroes: boolean;
  readonly attacker: CalculatorAttacker;
  readonly target: CalculatorTarget;
  readonly duel: readonly [DuelFighter, DuelFighter];
}

const SOLDIER_ORDER: readonly string[] = [
  'fist',
  'wooden_spear',
  'iron_spear',
  'short_sword',
  'long_sword',
  'short_bow',
  'long_bow',
  'catapult',
];
const CIVILIAN_ORDER: readonly string[] = ['woman_fist', 'hunter_bow', 'house_bow'];
const DEFAULT_WEAPON = 'iron_spear';
/** Worn in every default fight: the armour a settler gets first. */
const DEFAULT_ARMOUR: ArmourId = 'leather';

export interface WeaponGroup {
  readonly id: WeaponGroupId;
  readonly weapons: readonly KnowledgeWeapon[];
}

/** A tribe's fighting rows in reading order; heroes come only when asked for. */
export function weaponGroups(base: KnowledgeBase, tribe: number, heroes: boolean): readonly WeaponGroup[] {
  const usable = weaponsOf(base, tribe).filter((w) => w.usable);
  const pick = (ids: readonly string[]): KnowledgeWeapon[] =>
    ids.flatMap((id) => usable.find((w) => w.id === id) ?? []);
  return [
    { id: 'soldier' as const, weapons: pick(SOLDIER_ORDER) },
    { id: 'civilian' as const, weapons: pick(CIVILIAN_ORDER) },
    ...(heroes ? [{ id: 'hero' as const, weapons: usable.filter(isNamedHeroWeapon) }] : []),
  ].filter((group) => group.weapons.length > 0);
}

/** The name a reader knows a fighting row by. */
export function weaponLabel(weapon: KnowledgeWeapon): string {
  const names: Readonly<Record<string, string | undefined>> = messages().knowledge.mechanics.weapons;
  if (isHeroWeapon(weapon)) return weapon.jobName ?? weapon.id;
  return names[weapon.id] ?? weapon.goodName ?? weapon.jobName ?? weapon.id;
}

/** The row `id` names for `tribe`, else the first soldier's; hero rows are always reachable. */
export function weaponFor(base: KnowledgeBase, tribe: number, id: string): KnowledgeWeapon | undefined {
  const usable = weaponsOf(base, tribe).filter((w) => w.usable);
  return usable.find((w) => w.id === id) ?? weaponGroups(base, tribe, false)[0]?.weapons[0] ?? usable[0];
}

function firstBuilding(base: KnowledgeBase): KnowledgeBuilding | undefined {
  return base.buildings.find((b) => b.hitpoints !== null);
}

export function initialCalculator(base: KnowledgeBase, tribe: number): CalculatorState {
  const fighter: DuelFighter = {
    tribe,
    weapon: DEFAULT_WEAPON,
    hits: 0,
    strength: false,
    armour: DEFAULT_ARMOUR,
    defense: false,
  };
  return {
    homeTribe: tribe,
    mode: 'blow',
    heroes: false,
    attacker: { tribe, weapon: DEFAULT_WEAPON, hits: 0, strength: false, sector: 'front' },
    target: {
      kind: 'person',
      armour: DEFAULT_ARMOUR,
      defense: false,
      animal: base.animals[0]?.tribe ?? 0,
      building: firstBuilding(base)?.id ?? '',
      buildingTribe: tribe,
      vehicle: base.vehicles[0]?.id ?? '',
      health: null,
    },
    duel: [fighter, fighter],
  };
}

/** Points the calculator at `weaponId`, opening the heroes when that is where the row sits. */
export function withWeapon(state: CalculatorState, weaponId: string): CalculatorState {
  return {
    ...state,
    mode: 'blow',
    heroes: state.heroes || weaponId.startsWith('hero_'),
    attacker: { ...state.attacker, weapon: weaponId },
  };
}

/** Moves every side to the window's tribe when the reader changed it there; a pick made here stays. */
export function withHomeTribe(state: CalculatorState, tribe: number): CalculatorState {
  if (state.homeTribe === tribe) return state;
  const [left, right] = state.duel;
  return {
    ...state,
    homeTribe: tribe,
    attacker: { ...state.attacker, tribe },
    target: { ...state.target, buildingTribe: tribe },
    duel: [
      { ...left, tribe },
      { ...right, tribe },
    ],
  };
}

const personTarget = (base: KnowledgeBase, armour: ArmourId): CombatTarget | undefined =>
  combatTargets(base).find((t) => t.id === armour);

export interface ResolvedTarget {
  readonly combat: CombatTarget;
  readonly fullHealth: number;
  readonly health: number;
}

/** What the target fields amount to; undefined where the content holds no such row. */
export function resolveTarget(base: KnowledgeBase, target: CalculatorTarget): ResolvedTarget | undefined {
  const pair = ((): readonly [CombatTarget | undefined, number | null | undefined] => {
    const of = (id: 'building' | 'vehicle') => combatTargets(base).find((t) => t.id === id);
    switch (target.kind) {
      case 'person':
        return [personTarget(base, target.armour), HUMAN_HITPOINTS];
      case 'animal':
        return [ANIMAL_TARGET, base.animals.find((a) => a.tribe === target.animal)?.hitpoints];
      case 'building': {
        const house = base.buildingById.get(target.building);
        return [of('building'), house === undefined ? null : buildingHitpoints(house, target.buildingTribe)];
      }
      case 'vehicle':
        return [of('vehicle'), base.vehicles.find((v) => v.id === target.vehicle)?.hitpoints];
    }
  })();
  const [combat, fullHealth] = pair;
  if (combat === undefined || fullHealth === null || fullHealth === undefined) return undefined;
  const health = Math.min(fullHealth, Math.max(1, target.health ?? fullHealth));
  return { combat, fullHealth, health };
}

function directionOf(sector: DialSectorId): number {
  return DIAL_SECTORS.find((s) => s.id === sector)?.direction ?? HIT_DIRECTION.front;
}

function modifiersOf(state: CalculatorState, target: ResolvedTarget): BlowModifiers {
  const { attacker } = state;
  return {
    direction: directionOf(attacker.sector),
    hits: attacker.hits,
    strength: attacker.strength,
    defense: target.combat.person && state.target.defense,
  };
}

/** Why a rule leaves a step out for this blow; null for a step that runs. */
export type StepSkip = 'catapult' | 'hero' | 'notPerson' | 'notWorn' | 'ranged' | 'vehicle';

export interface BreakdownRow {
  readonly id: BlowStep['id'];
  readonly value: number;
  /** What the step did to the running damage; the rows sum to the landed damage. */
  readonly change: number;
  readonly skip: StepSkip | null;
}

function skipOf(
  step: BlowStep,
  weapon: KnowledgeWeapon,
  target: CombatTarget,
  modifiers: BlowModifiers,
): StepSkip | null {
  switch (step.id) {
    case 'experience':
      if (isHeroWeapon(weapon)) return 'hero';
      if (isRanged(weapon)) return 'ranged';
      return target.vehicle ? 'vehicle' : null;
    case 'direction':
    case 'block':
      return target.person ? null : 'notPerson';
    case 'strength':
      if (!takesStrengthAmulet(weapon)) return 'catapult';
      return modifiers.strength ? null : 'notWorn';
    case 'defense':
      if (!target.person) return 'notPerson';
      return modifiers.defense ? null : 'notWorn';
    default:
      return null;
  }
}

export function breakdown(
  weapon: KnowledgeWeapon,
  target: CombatTarget,
  modifiers: BlowModifiers,
): readonly BreakdownRow[] {
  let running = 0;
  return blowSteps(weapon, target, modifiers).flatMap((step) => {
    if (step.id === 'floor' && !step.applies) return [];
    const row: BreakdownRow = {
      id: step.id,
      value: step.value,
      change: step.value - running,
      skip: skipOf(step, weapon, target, modifiers),
    };
    running = step.value;
    return [row];
  });
}

export interface BlowOutcome {
  readonly damage: number;
  /** Blows to kill; null for a blow that does nothing. */
  readonly hits: number | null;
  /** Null when the blow does nothing or the row has no clip. */
  readonly seconds: number | null;
  readonly perSecond: number | null;
}

function outcome(weapon: KnowledgeWeapon, damage: number, health: number): BlowOutcome {
  const hits = hitsToKill(damage, health);
  return {
    damage,
    hits,
    seconds: hits === null ? null : secondsForHits(hits, weapon),
    perSecond: perSecond(damage, weapon),
  };
}

const landedOf = (rows: readonly BreakdownRow[]): number => rows.at(-1)?.value ?? 0;

export interface BlowResult extends BlowOutcome {
  readonly weapon: KnowledgeWeapon;
  readonly target: ResolvedTarget;
  readonly rows: readonly BreakdownRow[];
  /** The current blow takes these controls; false greys them out. */
  readonly gainsExperience: boolean;
  readonly takesStrength: boolean;
}

export function blowResult(base: KnowledgeBase, state: CalculatorState): BlowResult | undefined {
  const { attacker } = state;
  const weapon = weaponFor(base, attacker.tribe, attacker.weapon);
  const target = resolveTarget(base, state.target);
  if (weapon === undefined || target === undefined) return undefined;
  const rows = breakdown(weapon, target.combat, modifiersOf(state, target));
  return {
    ...outcome(weapon, landedOf(rows), target.health),
    weapon,
    target,
    rows,
    gainsExperience: gainsFightExperience(weapon, target.combat),
    takesStrength: takesStrengthAmulet(weapon),
  };
}

export interface RankingRow extends BlowOutcome {
  readonly weapon: KnowledgeWeapon;
  /** The row's bar, the fastest kill being 1 and a row with no time 0. */
  readonly share: number;
}

/** Where a row sorts: its time, then what cannot kill, then a row with no clip to time it by. */
function killOrder({ seconds, hits }: BlowOutcome): number {
  return seconds ?? (hits === null ? Number.MAX_VALUE : Infinity);
}

/** Every weapon on show, fastest kill of the chosen target first. */
export function ranking(base: KnowledgeBase, state: CalculatorState): readonly RankingRow[] {
  const target = resolveTarget(base, state.target);
  if (target === undefined) return [];
  const modifiers = modifiersOf(state, target);
  const rows = weaponGroups(base, state.attacker.tribe, state.heroes)
    .flatMap((group) => group.weapons)
    .map((weapon) => ({
      weapon,
      ...outcome(weapon, landedOf(breakdown(weapon, target.combat, modifiers)), target.health),
    }))
    .sort((a, b) => killOrder(a) - killOrder(b));
  const fastest = rows[0]?.seconds ?? null;
  return rows.map((row) => ({
    ...row,
    share: fastest === null || row.seconds === null ? 0 : fastest / row.seconds,
  }));
}

export interface DuelSide {
  readonly weapon: KnowledgeWeapon;
  readonly damage: number;
  readonly hits: number | null;
  /** How long this fighter needs for the kill, alone; null if he never gets there. */
  readonly seconds: number | null;
}

export type DuelVerdict =
  | { readonly kind: 'win'; readonly winner: 0 | 1; readonly seconds: number; readonly healthLeft: number }
  | { readonly kind: 'draw'; readonly seconds: number }
  | { readonly kind: 'stalemate' };

export interface DuelResult {
  readonly sides: readonly [DuelSide, DuelSide];
  readonly verdict: DuelVerdict;
}

function duelSide(base: KnowledgeBase, fighter: DuelFighter, foe: DuelFighter): DuelSide | undefined {
  const weapon = weaponFor(base, fighter.tribe, fighter.weapon);
  const armour = personTarget(base, foe.armour);
  if (weapon === undefined || armour === undefined) return undefined;
  const damage = landedOf(
    breakdown(weapon, armour, {
      direction: HIT_DIRECTION.front,
      hits: fighter.hits,
      strength: fighter.strength,
      defense: foe.defense,
    }),
  );
  const hits = hitsToKill(damage);
  return { weapon, damage, hits, seconds: hits === null ? null : secondsForHits(hits, weapon) };
}

/** Whole clips, in ticks, `side` needs for the kill; integers, so a tie is a true tie. */
function killTicks({ hits, weapon }: DuelSide): number | null {
  return hits === null || weapon.clipTicks === null
    ? null
    : Math.ceil(hits / weapon.blows) * weapon.clipTicks;
}

/** The health the winner keeps once `ticks` have passed under the loser's finished clips. */
function healthAfter(loser: DuelSide, ticks: number): number {
  const clip = loser.weapon.clipTicks;
  if (clip === null) return HUMAN_HITPOINTS;
  return HUMAN_HITPOINTS - Math.floor(ticks / clip) * loser.weapon.blows * loser.damage;
}

/** Two fighters trade blows from the first tick, each landing every one; a clip counts when it ends. */
export function duelResult(
  base: KnowledgeBase,
  [left, right]: readonly [DuelFighter, DuelFighter],
): DuelResult | undefined {
  const a = duelSide(base, left, right);
  const b = duelSide(base, right, left);
  if (a === undefined || b === undefined) return undefined;
  const sides = [a, b] as const;
  const ticksA = killTicks(a);
  const ticksB = killTicks(b);
  const win = (winner: 0 | 1, ticks: number, loser: DuelSide): DuelVerdict => ({
    kind: 'win',
    winner,
    seconds: ticks * SECONDS_PER_TICK,
    healthLeft: healthAfter(loser, ticks),
  });
  if (ticksA === null && ticksB === null) return { sides, verdict: { kind: 'stalemate' } };
  if (ticksB === null || (ticksA !== null && ticksA < ticksB)) {
    return { sides, verdict: win(0, ticksA ?? 0, b) };
  }
  if (ticksA === null || ticksB < ticksA) return { sides, verdict: win(1, ticksB, a) };
  return { sides, verdict: { kind: 'draw', seconds: ticksA * SECONDS_PER_TICK } };
}
