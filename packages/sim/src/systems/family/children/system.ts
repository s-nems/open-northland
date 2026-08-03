import {
  ChildOrder,
  FamilyDuty,
  FoodReserve,
  MakingLove,
  Marriage,
  Position,
  Residence,
  Settler,
  Sheltering,
} from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { isInside } from '../../settlers/indoors.js';
import { canonicalById } from '../../spatial/nodes.js';
import { ExternalFoodIndex } from '../food-search.js';
import { type ChildOrderPass, driveOrder } from './order.js';

/**
 * The child-making half of the FamilySystem: drive every married woman's standing {@link ChildOrder} one
 * tick through its stages (`./order.ts`), then strip whatever this tick's orders did not re-claim.
 *
 * Source basis: the food threshold, the ordered sex, and the one-child limit are user-specified design
 * (the original gates conception engine-internally; homes are its only food-stocking residences).
 */
export function driveChildOrders(world: World, ctx: SystemContext, terrain: TerrainGraph | undefined): void {
  cancelAbandonedSessions(world);
  const dutyBefore = canonicalById(world.query(FamilyDuty));
  const pass: ChildOrderPass = {
    dutyClaimed: new Set<Entity>(),
    reservesReclaimed: new Set<Entity>(),
    externalFood: new ExternalFoodIndex(world, ctx, terrain),
  };
  for (const e of canonicalById(world.query(ChildOrder, Settler, Position))) {
    // A mother running for cover keeps her standing order but not her errand: the order resumes when
    // the alarm drops, and until then nothing walks her out of the shelter (its duty hold is dropped
    // with every other unclaimed one below).
    if (world.has(e, Sheltering)) continue;
    driveOrder(world, ctx, terrain, e, pass);
  }
  for (const home of canonicalById(world.query(FoodReserve))) {
    if (!pass.reservesReclaimed.has(home)) world.remove(home, FoodReserve);
  }
  for (const e of dutyBefore) {
    if (!pass.dutyClaimed.has(e)) world.remove(e, FamilyDuty);
  }
}

/**
 * Cancel every {@link MakingLove} session whose owning couple no longer carries it out: the wife died,
 * dropped her order, moved home, or either parent stepped (or was pulled) outside. Central, and ahead of
 * any order, so an abandoned session can never linger and block the home for its other resident couples;
 * the food it consumed stays spent.
 */
function cancelAbandonedSessions(world: World): void {
  for (const home of canonicalById(world.query(MakingLove))) {
    const wife = world.get(home, MakingLove).wife;
    const marriage = world.isAlive(wife) ? world.tryGet(wife, Marriage) : undefined;
    const husband = marriage !== undefined && world.isAlive(marriage.spouse) ? marriage.spouse : undefined;
    const valid =
      husband !== undefined &&
      world.has(wife, ChildOrder) &&
      world.tryGet(wife, Residence)?.home === home &&
      isInside(world, wife, home) &&
      isInside(world, husband, home);
    if (!valid) world.remove(home, MakingLove);
  }
}
