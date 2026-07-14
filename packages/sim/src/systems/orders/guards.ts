import { Owner, Settler } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';

/** Whether `e` is a living, owned settler the player may issue a command to — the shared target guard
 *  for the profession, stance, and work-flag order handlers. A dead/stale, non-settler, or neutral
 *  (unowned) target is a recoverable no-op (still logged for faithful replay). Handlers that also need a
 *  {@link import('../../components/movement.js').Position} or {@link import('../../components/combat.js').Health}
 *  keep those extra checks inline. */
export function isOrderableSettler(world: World, e: Entity): boolean {
  return world.isAlive(e) && world.has(e, Settler) && world.has(e, Owner);
}
