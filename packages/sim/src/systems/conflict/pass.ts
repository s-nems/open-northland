import type { Entity } from '../../ecs/world.js';
import type { CombatIndex } from './combat-index.js';
import type { MeleeSlots } from './melee-slots.js';

/** The derived state one CombatSystem pass builds once and every combatant it resolves reads. */
export interface CombatPass {
  readonly index: CombatIndex;
  readonly slots: MeleeSlots;
  readonly seats: ReadonlyMap<Entity, number>;
  /** Garrison searches already answered this pass, keyed by their inputs. Read-only to every seat that shares
   *  one: the band is handed out, never edited. */
  readonly bands: Map<string, ReturnType<CombatIndex['nearestFew']>>;
}
