import { Age, Female, Owner, Settler } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';

/** Whether `e` is a living, owned settler the player may issue a command to — the shared target guard
 *  for the profession, stance, and work-flag order handlers. A dead/stale, non-settler, or neutral
 *  (unowned) target is a recoverable no-op (still logged for faithful replay). Handlers that also need a
 *  {@link import('../../components/movement.js').Position} or {@link import('../../components/combat.js').Health}
 *  keep those extra checks inline. */
export function isOrderableSettler(world: World, e: Entity): boolean {
  return world.isAlive(e) && world.has(e, Settler) && world.has(e, Owner);
}

/** Whether the player may set `e`'s trade or post it to a workplace. Beyond {@link isOrderableSettler}: a
 *  still-growing child ({@link Age}) is the GrowthSystem's to class, not the player's, and a woman keeps the
 *  woman role for life — the trades are male (faithful to the original's job model; user decision
 *  2026-07-16), her work being the household: hoarding food home and bearing children. */
export function isTradeAssignable(world: World, e: Entity): boolean {
  return isOrderableSettler(world, e) && !world.has(e, Age) && !world.has(e, Female);
}
