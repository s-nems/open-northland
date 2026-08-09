import { Building, Owner, ownerOf, Person } from '../../components/index.js';
import { ONE } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import { canonicalById } from '../spatial/nodes.js';

/** The seat's buildings (any construction state) in canonical ascending-id order. */
export function ownedBuildings(world: World, player: number): Entity[] {
  return canonicalById(world.query(Building, Owner)).filter((e) => ownerOf(world, e) === player);
}

/** The seat's people, canonical ascending-id order; claimed livestock carries an {@link Owner} too, so the
 *  {@link Person} key is what keeps the herd out of the seat's manpower. */
export function ownedSettlers(world: World, player: number): Entity[] {
  return canonicalById(world.query(Person, Owner)).filter((e) => ownerOf(world, e) === player);
}

/** Whether the building's construction (or its latest upgrade) is complete. */
export function isBuilt(world: World, e: Entity): boolean {
  return world.get(e, Building).built >= ONE;
}
