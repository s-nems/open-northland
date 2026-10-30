import { defineComponent } from '../../ecs/world.js';

/** The shape of a seat's economy, read from its seat brief. Authored names, kept here so a retune touches
 *  only this list and the selector's rules. */
export const ECONOMIC_ARCHETYPES = ['standard', 'cramped', 'rich', 'islands'] as const;
export type EconomicArchetype = (typeof ECONOMIC_ARCHETYPES)[number];

/** The production lines a seat leans on beside its archetype; `ironArms` and `naturalArms` exclude each
 *  other. Canonical order: a record lists its sides in this order. */
export const ECONOMIC_SIDES = ['ironArms', 'naturalArms', 'goldLine', 'fishing', 'herbs'] as const;
export type EconomicSide = (typeof ECONOMIC_SIDES)[number];

/** The selector rules that can fire, the evidence a debug view shows. Canonical order as for sides. */
export const ECONOMIC_RULES = [
  'islandStart',
  'homeFreeShareLow',
  'homeClearableDominant',
  'homeRoomSmall',
  'nearRich',
  'ironInReach',
  'ironOutOfReach',
  'goldAndMushroomOnLand',
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

/** A computer seat's strategy, one section per concern (economy now; the military posture joins it as a
 *  sibling section). */
export interface ComputerStrategyState {
  economy: EconomicStrategyState;
}

/** Held on the seat's `AiControl` carrier, so it dies with the seat (`systems/computer-player/strategy`). */
export const ComputerStrategy = defineComponent<ComputerStrategyState>('ComputerStrategy', 'players');
