import { LostWay, Person } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';

/** Tell the player `e` found no way. Livestock takes walk orders too, but only a person is reported. */
export function announceLostWay(world: World, ctx: SystemContext, e: Entity): void {
  if (world.has(e, Person)) ctx.events.emit({ kind: 'settlerLost', entity: e });
}

function stamp(world: World, ctx: SystemContext, e: Entity, cutOff: boolean): void {
  if (!world.has(e, Person)) return;
  const lost = world.tryGet(e, LostWay);
  if (lost === undefined) {
    world.add(e, LostWay, { cutOff });
    announceLostWay(world, ctx, e);
  } else if (cutOff && !lost.cutOff) {
    world.mut(e, LostWay).cutOff = true;
  }
}

/** Stamp `e` lost over a way it found none of, and tell the player once per episode. */
export function markLostWay(world: World, ctx: SystemContext, e: Entity): void {
  stamp(world, ctx, e, false);
}

/** Stamp `e` lost over a seat with no door in reach; an already lost settler only gains this kind. */
export function markCutOff(world: World, ctx: SystemContext, e: Entity): void {
  stamp(world, ctx, e, true);
}

export function clearLostWay(world: World, e: Entity): void {
  world.remove(e, LostWay);
}
