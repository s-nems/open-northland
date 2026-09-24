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
import { ExternalFoodIndex } from '../food-search.js';
import { type ChildOrderPass, driveOrder } from './order.js';

/**
 * The child-making half of the FamilySystem: drive every married woman's standing {@link ChildOrder} one
 * tick through its stages, then strip whatever this tick's orders did not re-claim. Authored: the food
 * threshold, the ordered sex, and the one-child limit; the original gates conception engine-internally.
 */
export function driveChildOrders(world: World, ctx: SystemContext, terrain: TerrainGraph | undefined): void {
  cancelAbandonedSessions(world);
  const dutyBefore = world.canonicalQuery(FamilyDuty);
  const pass: ChildOrderPass = {
    dutyClaimed: new Set<Entity>(),
    reservesReclaimed: new Set<Entity>(),
    externalFood: new ExternalFoodIndex(world, ctx, terrain),
  };
  for (const e of world.canonicalQuery(ChildOrder, Settler, Position)) {
    // A sheltering mother keeps her standing order but not her errand; nothing walks her out of cover
    // until the alarm drops.
    if (world.has(e, Sheltering)) continue;
    driveOrder(world, ctx, terrain, e, pass);
  }
  for (const home of world.canonicalQuery(FoodReserve)) {
    if (!pass.reservesReclaimed.has(home)) world.remove(home, FoodReserve);
  }
  for (const e of dutyBefore) {
    if (!pass.dutyClaimed.has(e)) world.remove(e, FamilyDuty);
  }
}

/**
 * Cancel every {@link MakingLove} session its couple no longer carries out. Central and ahead of any
 * order, so an abandoned session cannot linger and block the home for its other resident couples; the
 * food it consumed stays spent.
 */
function cancelAbandonedSessions(world: World): void {
  for (const home of world.canonicalQuery(MakingLove)) {
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
