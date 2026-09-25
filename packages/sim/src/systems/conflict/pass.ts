import type { BattleFront } from './battle-alert.js';
import type { CombatIndex } from './combat-index.js';
import type { MeleeSlots } from './melee-slots.js';

/** The derived state one CombatSystem pass builds once and every combatant it resolves reads. */
export interface CombatPass {
  readonly index: CombatIndex;
  readonly slots: MeleeSlots;
  /** The fights a sleeper gets up for, bucketed on its first question. */
  readonly front: BattleFront;
}
