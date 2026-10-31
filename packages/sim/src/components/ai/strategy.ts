import { defineComponent } from '../../ecs/world.js';

/** The shape of a seat's economy, read from its seat brief. Authored names, kept here so a retune touches
 *  only this list and the selector's rules. */
export const ECONOMIC_ARCHETYPES = ['standard', 'cramped', 'rich', 'islands'] as const;
export type EconomicArchetype = (typeof ECONOMIC_ARCHETYPES)[number];

/** The production lines a seat leans on beside its archetype; `ironArms` (iron to spare: plate and mail),
 *  `ironWeapons` (little iron: weapons only, tunics for armour) and `naturalArms` (none in reach) exclude
 *  each other, `oneMint` (little gold) trims the gold line, and `noRoom` (a whole land too small to grow
 *  on) keeps one of each workshop. Canonical order: a record lists its sides in this order. */
export const ECONOMIC_SIDES = [
  'ironArms',
  'ironWeapons',
  'naturalArms',
  'goldLine',
  'oneMint',
  'fishing',
  'herbs',
  'noRoom',
] as const;
export type EconomicSide = (typeof ECONOMIC_SIDES)[number];

/** The selector rules that can fire, the evidence a debug view shows. Canonical order as for sides. */
export const ECONOMIC_RULES = [
  'islandStart',
  'homeFreeShareLow',
  'homeClearableDominant',
  'homeRoomSmall',
  'landRoomSmall',
  'nearRich',
  'ironInReach',
  'ironScarce',
  'ironOutOfReach',
  'goldAndMushroomOnLand',
  'goldScarce',
  'fishNearby',
  'grassAtHome',
] as const;
export type EconomicRule = (typeof ECONOMIC_RULES)[number];

/** One review's economic choice. */
export interface EconomicChoice {
  archetype: EconomicArchetype;
  sides: EconomicSide[];
  evidence: EconomicRule[];
}

export interface EconomicStrategyState extends EconomicChoice {
  /** The tick the current archetype was decided. */
  decidedAt: number;
  /** A different archetype the latest reviews agreed on, and in how many reviews in a row; null while
   *  they agree with the current one. */
  challenger: { archetype: EconomicArchetype; reviews: number } | null;
}

/** A seat's military personality, drawn once (`systems/computer-player/strategy/military.ts`). Owner
 *  ruling: an aggressive seat attacks more often with more army and fewer towers, a defensive one builds
 *  more towers, a harasser raids the enemy's economy from the flank. */
export const MILITARY_PLANS = ['aggressive', 'defensive', 'harasser', 'balanced'] as const;
export type MilitaryPlan = (typeof MILITARY_PLANS)[number];

/** What the army does now. `prepare` and `defend` hold it at home; `attack` and `harass` let waves march,
 *  and `harass` allows raids. */
export const MILITARY_POSTURES = ['defend', 'attack', 'harass', 'prepare'] as const;
export type MilitaryPosture = (typeof MILITARY_POSTURES)[number];

/** The posture rules that can fire, the evidence a debug view shows. Canonical order as for sides. */
export const MILITARY_RULES = [
  'forecastThreat',
  'underAttack',
  'outmatched',
  'ratioReached',
  'noTarget',
  'harasserPlan',
  'raidTargetKnown',
  'buildingUp',
] as const;
export type MilitaryRule = (typeof MILITARY_RULES)[number];

/** One posture review's choice and the numbers it read. */
export interface MilitaryChoice {
  posture: MilitaryPosture;
  evidence: MilitaryRule[];
  /** The seat's own fighter points (`military/points.ts`). */
  ownPoints: number;
  /** The owner of the campaign target the review weighed, and the points it believes he defends with;
   *  null without a target. */
  targetOwner: number | null;
  targetPoints: number | null;
  /** The strongest enemy's believed points, null when it knows of none. */
  strongestPoints: number | null;
  /** Ticks until the nearest forecast scripted attack on the seat, 0 inside its window, null for none. */
  threatInTicks: number | null;
}

export interface MilitaryStrategyState extends MilitaryChoice {
  plan: MilitaryPlan;
  /** The tick the current posture was decided. */
  decidedAt: number;
  /** A different posture the latest reviews agreed on, and in how many reviews in a row. */
  challenger: { posture: MilitaryPosture; reviews: number } | null;
}

/** A computer seat's strategy, one section per concern. */
export interface ComputerStrategyState {
  economy: EconomicStrategyState;
  military: MilitaryStrategyState;
}

/** Held on the seat's `AiControl` carrier, so it dies with the seat (`systems/computer-player/strategy`). */
export const ComputerStrategy = defineComponent<ComputerStrategyState>('ComputerStrategy', 'players');
