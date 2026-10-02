import type { BattleFront } from './battle-alert.js';
import type { CombatIndex } from './combat-index.js';
import type { CombatantStance, EngagementSpecs } from './engagement.js';
import type { MeleeSlots } from './melee-slots.js';

/** The derived state one CombatSystem pass builds once and every combatant it resolves reads. */
export interface CombatPass {
  specs?: EngagementSpecs;
  readonly index: CombatIndex;
  readonly slots: MeleeSlots;
  /** The fights a sleeper gets up for, bucketed on its first question. */
  readonly front: BattleFront;
  /** The stance of the combatant being resolved, refilled per combatant: no rung keeps it past its call. */
  readonly stance: Mutable<CombatantStance>;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
