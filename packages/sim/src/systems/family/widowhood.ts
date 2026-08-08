import { Female, Marriage, Residence } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { raisingChild } from './eligibility.js';

// The widowing rule: event-driven, never called from a whole-world per-tick scan.

/**
 * Dissolve `survivor`'s marriage once the spouse is dead and no growing child remains, and evict a male
 * survivor. Authored: homes anchor on women, so a widower rejoins the marriage pool to be housed into a
 * wife's home while a widow keeps hers and refills it by remarrying. The dead-spouse Marriage is the only
 * carrier of the parent-child edge, so it must outlive the spouse until the child is grown.
 */
export function settleWidowhood(world: World, survivor: Entity): void {
  const marriage = world.tryGet(survivor, Marriage);
  if (marriage === undefined || world.isAlive(marriage.spouse)) return;
  if (raisingChild(world, marriage)) return;
  world.remove(survivor, Marriage);
  if (!world.has(survivor, Female)) world.remove(survivor, Residence);
}

/**
 * Re-evaluate the widowhood of every parent whose {@link Marriage} names `child`. Collect-then-settle, so
 * the Marriage store is never mutated mid-query; each settle touches only its own parent, so the
 * unordered scan cannot change the outcome.
 */
export function releaseWidowedParentsOf(world: World, child: Entity): void {
  const parents: Entity[] = [];
  for (const e of world.query(Marriage)) {
    if (world.get(e, Marriage).child === child) parents.push(e);
  }
  for (const parent of parents) settleWidowhood(world, parent);
}
