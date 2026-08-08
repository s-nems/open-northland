import type { Entity } from '../../ecs/world.js';
import type { NodeBuckets } from '../spatial/nodes.js';
import type { MeleeSlots } from './melee-slots.js';
import type { HostilePresence } from './presence.js';
import type { BuildingBodyNodeCache } from './target-node.js';

/** The derived state one CombatSystem pass builds once and every combatant it resolves reads. */
export interface CombatPass {
  readonly index: NodeBuckets;
  readonly presence: HostilePresence;
  readonly slots: MeleeSlots;
  readonly bodyNodes: BuildingBodyNodeCache;
  readonly seats: ReadonlyMap<Entity, number>;
  /** Ring searches already answered this pass, keyed by their inputs. Read-only to every seat that shares
   *  one: the band is handed out, never edited. */
  readonly bands: Map<string, ReturnType<NodeBuckets['nearestFew']>>;
}
