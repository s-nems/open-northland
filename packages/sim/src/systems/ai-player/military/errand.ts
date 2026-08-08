import { CurrentAtomic, EquipOrder, TrainingOrder } from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import { isTravelling } from '../../movement/nav-state.js';
import { anotherSystemOwns } from '../../settlers/planner/replan.js';

/** Whether another drive owns `e`, or he is on an errand an order would throw away: a walk order or an
 *  employment change strips a drill and an equip run and cancels a running action. One predicate for every
 *  rung that reaches into the free band, so they cannot disagree about who is free. */
export function spokenFor(world: World, e: Entity): boolean {
  return (
    anotherSystemOwns(world, e) ||
    world.has(e, TrainingOrder) ||
    world.has(e, EquipOrder) ||
    world.has(e, CurrentAtomic) ||
    isTravelling(world, e)
  );
}
