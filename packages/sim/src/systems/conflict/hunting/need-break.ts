import { Engagement, HuntFocus } from '../../../components/index.js';
import { TICKS_PER_SECOND } from '../../../core/loop.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { clearNavState } from '../../movement/nav-state.js';
import { anyNeedPressing } from '../../settlers/drives/needs.js';

// The hunter's break for a meal: a chase or a volley would otherwise keep the planner off it until it starves.

/**
 * How often (ticks) a hungry or tired hunter looks up from its prey while the planner finds nothing to
 * answer the need with. Pure pacing, no source basis.
 */
export const HUNT_NEED_BREAK_TICKS = 5 * TICKS_PER_SECOND;

/**
 * Whether a self-committed hunter with a pressing need stands this tick instead of shooting or chasing, so
 * the planner can send it off to answer the need. Where nothing answers it, the hunt goes on the next tick
 * and the need is asked again after {@link HUNT_NEED_BREAK_TICKS}, so a hunter with no food around keeps
 * hunting for some.
 */
export function breaksHuntForNeed(world: World, ctx: SystemContext, e: Entity, ordered: boolean): boolean {
  const focus = world.tryGet(e, HuntFocus);
  if (ordered || focus === undefined || !world.has(e, Engagement)) return false;
  if (ctx.tick < (focus.needBreakAt ?? 0) || !anyNeedPressing(world, ctx.content, e)) return false;
  world.mut(e, HuntFocus).needBreakAt = ctx.tick + HUNT_NEED_BREAK_TICKS;
  clearNavState(world, e);
  return true;
}
