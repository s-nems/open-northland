import { LostWay, Person } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { NodeId } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';

/** Tell the player `e` found no way. Livestock takes walk orders too, but only a person is reported. */
export function announceLostWay(world: World, ctx: SystemContext, e: Entity): void {
  if (world.has(e, Person)) ctx.events.emit({ kind: 'settlerLost', entity: e });
}

function stamp(world: World, ctx: SystemContext, e: Entity, cutOff: boolean, goal: NodeId | null): void {
  if (!world.has(e, Person)) return;
  const lost = world.tryGet(e, LostWay);
  if (lost === undefined) {
    world.add(e, LostWay, { cutOff, since: ctx.tick, goal });
    announceLostWay(world, ctx, e);
    return;
  }
  if (cutOff && !lost.cutOff) world.mut(e, LostWay).cutOff = true;
  if (goal !== null && goal !== lost.goal) world.mut(e, LostWay).goal = goal;
}

/** Stamp `e` lost over the way to `goal` it found none of, and tell the player once per episode. */
export function markLostWay(world: World, ctx: SystemContext, e: Entity, goal: NodeId | null): void {
  stamp(world, ctx, e, false, goal);
}

/** Stamp `e` lost over a post or seat out of reach, `goal` the door or site when one names it; an already
 *  lost settler only gains this kind and the newer goal. */
export function markCutOff(world: World, ctx: SystemContext, e: Entity, goal: NodeId | null): void {
  stamp(world, ctx, e, true, goal);
}

export function clearLostWay(world: World, e: Entity): void {
  world.remove(e, LostWay);
}
