import { Female, Marriage, Residence } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { raisingChild } from './eligibility.js';

// The widowing rule, shared by its three triggers: a spouse's death, the couple's child growing up,
// and that child dying. Event-driven only, never called from a whole-world per-tick scan.

/**
 * Dissolve `survivor`'s marriage once the spouse is dead and no growing child remains, and evict a
 * male survivor: homes anchor on women (the AI refills a free family slot with a married woman), so
 * the widower rejoins the marriage pool to be housed into a wife's home while a widow keeps her home
 * and refills it by remarrying (user-specified design, 2026-07-18). No-op while the spouse lives or
 * a child still grows - the dead-spouse Marriage is the only carrier of the parent-child edge
 * (familyOf/assignHouse move the child with the survivor), so it must outlive the spouse until then.
 */
export function settleWidowhood(world: World, survivor: Entity): void {
  const marriage = world.tryGet(survivor, Marriage);
  if (marriage === undefined || world.isAlive(marriage.spouse)) return;
  if (raisingChild(world, marriage)) return;
  world.remove(survivor, Marriage);
  if (!world.has(survivor, Female)) world.remove(survivor, Residence);
}

/**
 * Re-evaluate the widowhood of every parent whose {@link Marriage} names `child` - the carve-out
 * expiry seam: the child growing up or dying is what lets a widowed parent's stale union dissolve.
 * A living couple's marriage is untouched ({@link settleWidowhood} no-ops on it). Collect-then-settle
 * so the Marriage store is never mutated mid-query; each settle touches only its own parent, so the
 * unordered scan cannot change the outcome.
 */
export function releaseWidowedParentsOf(world: World, child: Entity): void {
  const parents: Entity[] = [];
  for (const e of world.query(Marriage)) {
    if (world.get(e, Marriage).child === child) parents.push(e);
  }
  for (const parent of parents) settleWidowhood(world, parent);
}
