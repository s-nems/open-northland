import { CurrentAtomic, LostWay, MoveGoal, Person } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { NodeId } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';

/** Tell the player `e` found no way. Livestock takes walk orders too, but only a person is reported. */
export function announceLostWay(world: World, ctx: SystemContext, e: Entity): void {
  if (world.has(e, Person)) ctx.events.emit({ kind: 'settlerLost', entity: e });
}

function stamp(world: World, ctx: SystemContext, e: Entity, cutOff: boolean, goal: NodeId): void {
  if (!world.has(e, Person)) return;
  const lost = world.tryGet(e, LostWay);
  if (lost === undefined) {
    world.add(e, LostWay, { cutOff, since: ctx.tick, goal, tried: null });
    announceLostWay(world, ctx, e);
    return;
  }
  if (cutOff && !lost.cutOff) world.mut(e, LostWay).cutOff = true;
  if (goal !== lost.goal) world.mut(e, LostWay).goal = goal;
}

/** Stamp `e` lost over the way to `goal` it found none of, and tell the player once per episode. */
export function markLostWay(world: World, ctx: SystemContext, e: Entity, goal: NodeId): void {
  stamp(world, ctx, e, false, goal);
}

/** Stamp `e` lost over a post or seat out of reach, `goal` the door, flag or site; an already lost settler
 *  only gains this kind and the newer goal. */
export function markCutOff(world: World, ctx: SystemContext, e: Entity, goal: NodeId): void {
  stamp(world, ctx, e, true, goal);
}

export function clearLostWay(world: World, e: Entity): void {
  world.remove(e, LostWay);
}

/** Lift a mark `e`'s own walk earned, now that an obeyed order is its way. A cut-off mark stands: the
 *  order does not reach the seat or the work, so only its own check, or work taken, lifts it. */
export function liftLostWalk(world: World, e: Entity): void {
  if (world.tryGet(e, LostWay)?.cutOff === false) world.remove(e, LostWay);
}

/** A trade rung took `e`: a clip in place is the way found; on a walk, the way is found once the route to
 *  `goal` is, so the mark notes the goal and waits for the pathfinding pass; a stand in place, at a site
 *  short of material, is neither. A cut-off mark lifts on any of them, the work being what it was cut off
 *  from. */
export function noteWorkTaken(world: World, e: Entity): void {
  const lost = world.tryGet(e, LostWay);
  if (lost === undefined) return;
  const goal = world.tryGet(e, MoveGoal)?.cell;
  if (lost.cutOff || (goal === undefined && world.has(e, CurrentAtomic))) world.remove(e, LostWay);
  else if (goal !== undefined && lost.tried !== goal) world.mut(e, LostWay).tried = goal;
}

/** The pathfinding pass found `e` a route to `goal`: the way, when it is the work walk the mark waits on. */
export function routeFound(world: World, e: Entity, goal: NodeId): void {
  const lost = world.tryGet(e, LostWay);
  if (lost !== undefined && !lost.cutOff && lost.tried === goal) world.remove(e, LostWay);
}

/** Forget the work walk a mark waited on: `e` plans afresh, and a later walk to the same cell for another
 *  reason must not pass for it. */
export function forgetWorkTried(world: World, e: Entity): void {
  const lost = world.tryGet(e, LostWay);
  if (lost !== undefined && lost.tried !== null) world.mut(e, LostWay).tried = null;
}
