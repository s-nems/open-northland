import {
  ChildOrder,
  FamilyDuty,
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
import { wakeHumanIdler } from '../../settlers/planner/idle-replan.js';
import { collectSupplyTally } from '../../stores/index.js';
import { ExternalFoodIndex } from '../food-search.js';
import { type ChildOrderPass, DutyClaims, driveOrder } from './order.js';

/**
 * The child-making half of the FamilySystem: drive every married woman's standing {@link ChildOrder} one
 * tick through its stages, then strip whatever this tick's orders did not re-claim. Authored: the ordered
 * sex and the one-child limit.
 */
export function driveChildOrders(world: World, ctx: SystemContext, terrain: TerrainGraph | undefined): void {
  cancelAbandonedSessions(world);
  const dutyBefore = world.canonicalQuery(FamilyDuty);
  const supply = collectSupplyTally(world);
  const dutyClaimed = dutyClaimsOf(world);
  dutyClaimed.begin();
  const pass: ChildOrderPass = {
    dutyClaimed,
    externalFood: new ExternalFoodIndex(world, ctx, terrain, supply),
    supply,
  };
  const orders = world.canonicalQuery(ChildOrder, Settler, Position);
  for (let i = 0; i < orders.length; i++) {
    const e = orders[i] as Entity;
    // A sheltering mother keeps her standing order but not her errand; nothing walks her out of cover
    // until the alarm drops.
    if (world.has(e, Sheltering)) continue;
    driveOrder(world, ctx, terrain, e, pass);
  }
  for (let i = 0; i < dutyBefore.length; i++) {
    const e = dutyBefore[i] as Entity;
    if (dutyClaimed.has(e)) continue;
    world.remove(e, FamilyDuty);
    dutyClaimed.forget(e);
    // A birth or a stood-down order steps the holder out before its duty goes.
    wakeHumanIdler(world, e);
  }
  dutyClaimed.end();
}

const dutyClaims = new WeakMap<World, DutyClaims>();

function dutyClaimsOf(world: World): DutyClaims {
  let claims = dutyClaims.get(world);
  if (claims === undefined) {
    claims = new DutyClaims();
    dutyClaims.set(world, claims);
  }
  return claims;
}

/**
 * Cancel every {@link MakingLove} session its couple no longer carries out. Central and ahead of any
 * order, so an abandoned session cannot linger and block the home for its other resident couples; the
 * food it consumed stays spent.
 */
function cancelAbandonedSessions(world: World): void {
  const homes = world.canonicalQuery(MakingLove);
  for (let i = 0; i < homes.length; i++) {
    const home = homes[i] as Entity;
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
