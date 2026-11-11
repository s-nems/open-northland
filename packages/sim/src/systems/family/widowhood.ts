import { ChildOrder, Female, Marriage, Residence, Wedding } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { raisingChild } from './eligibility.js';
import { isMinor } from './households.js';

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

/** {@link releaseWidowedParentsOf} for several children at once: one {@link Marriage} walk collects each
 *  child's parents in the order that function visits them, for a caller that settles them child by child. */
export function parentsByChild(world: World, children: readonly Entity[]): Map<Entity, Entity[]> {
  const byChild = new Map<Entity, Entity[]>();
  for (const child of children) byChild.set(child, []);
  for (const e of world.query(Marriage)) {
    const child = world.get(e, Marriage).child;
    if (child !== null) byChild.get(child)?.push(e);
  }
  return byChild;
}

/**
 * Cut `e` out of its family while it lives on, as a script's handover to another player does. Original
 * behavior: the links to spouse, betrothed, parents and child are cleared on both sides. Here the spouse
 * left behind is settled as a widow or widower is ({@link settleWidowhood}), and since the marriage is
 * the only carrier of the parent-child edge, a growing child of the couple keeps its home as a household
 * of its own (approximation).
 */
export function leaveFamily(world: World, e: Entity): void {
  const wedding = world.tryGet(e, Wedding);
  if (wedding !== undefined) {
    if (world.isAlive(wedding.partner)) world.remove(wedding.partner, Wedding);
    world.remove(e, Wedding);
  }
  world.remove(e, ChildOrder);
  if (isMinor(world, e)) {
    for (const parent of parentsByChild(world, [e]).get(e) ?? []) {
      world.mut(parent, Marriage).child = null;
      settleWidowhood(world, parent);
    }
  }
  const spouse = world.tryGet(e, Marriage)?.spouse;
  if (spouse === undefined) return;
  world.remove(e, Marriage);
  if (!world.isAlive(spouse) || world.tryGet(spouse, Marriage)?.spouse !== e) return;
  world.remove(spouse, Marriage);
  world.remove(spouse, ChildOrder);
  if (!world.has(spouse, Female)) world.remove(spouse, Residence);
}
