import { CurrentAtomic, EquipOrder, TrainingOrder } from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import { isTravelling } from '../../spatial/nodes.js';

/** Errands an order would silently throw away: a walk order or an employment change strips the drill and
 *  the equip run and cancels a running action, and a fighter already walking is on his way somewhere for a
 *  reason. One predicate for every rung that reaches into the free band, so they cannot disagree about
 *  which man is spoken for. */
export function onAnErrand(world: World, e: Entity): boolean {
  return (
    world.has(e, TrainingOrder) ||
    world.has(e, EquipOrder) ||
    world.has(e, CurrentAtomic) ||
    isTravelling(world, e)
  );
}
