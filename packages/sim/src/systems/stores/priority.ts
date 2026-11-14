import { Building, Owner, StorePriority, UnderConstruction } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { stockCapacity } from './capacity.js';
import { keepsStorePriority } from './workplace.js';

/** Mark `goodType` as priority in `store`. Needs a finished owned store whose type keeps porters and a
 *  shelf for the good; otherwise nothing changes. */
export function markStorePriority(world: World, ctx: SystemContext, store: Entity, goodType: number): void {
  const current = world.tryGet(store, StorePriority)?.goods;
  if (current?.includes(goodType) === true) return;
  const type = world.tryGet(store, Building)?.buildingType;
  if (type === undefined || !world.has(store, Owner) || world.has(store, UnderConstruction)) return;
  if (!keepsStorePriority(ctx.content, type) || stockCapacity(world, ctx, store, goodType) <= 0) return;
  if (current === undefined) {
    world.add(store, StorePriority, { goods: [goodType] });
    return;
  }
  const goods = world.mut(store, StorePriority).goods;
  goods.push(goodType);
  goods.sort((a, b) => a - b);
}

/** Unmark `goodType` in `store`, never refused; returns whether it was marked. */
export function liftStorePriority(world: World, store: Entity, goodType: number): boolean {
  const current = world.tryGet(store, StorePriority)?.goods;
  if (current === undefined || !current.includes(goodType)) return false;
  if (current.length === 1) world.remove(store, StorePriority);
  else {
    const goods = world.mut(store, StorePriority).goods;
    goods.splice(goods.indexOf(goodType), 1);
  }
  return true;
}
