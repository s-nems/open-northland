import { Engagement, HuntRest } from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { isHunterJob } from '../../readviews/index.js';
import type { CombatantStance, EngageSpec } from '../engagement.js';

// The breather between hunts: what keeps a hunter that keeps coming up empty off a full prey search every tick.

/**
 * How long (ticks) a hunter's prey acquisition rests after a pass that took no prey. Pure pacing, no source
 * basis.
 */
export const HUNT_SEARCH_REST_TICKS = 10;

/** Rest a hunter's prey acquisition after a pass that took no prey - an empty search, or a chase that gave its
 *  target up - so the next tick pays no target search and no carcass probe. Only the prey spec carries a `lock`,
 *  so a hunter fighting as a soldier is never paced; a DEFEND post-holder is not either, because the rest
 *  would also skip its walk-back retry. */
export function restPreySearch(world: World, ctx: SystemContext, e: Entity, spec: EngageSpec): void {
  if (spec.lock === null || spec.defend?.hold === true) return;
  if (world.has(e, HuntRest)) return;
  world.add(e, HuntRest, { until: ctx.tick + HUNT_SEARCH_REST_TICKS });
}

/** Whether a resting hunter skips this tick's acquisition, reaping a lapsed {@link HuntRest} as it reads it.
 *  Never rests an ordered focus or a live chase: an Engagement must keep re-resolving every tick so the chaser
 *  swings the instant it is in reach. */
export function preySearchResting(
  world: World,
  ctx: SystemContext,
  e: Entity,
  jobType: number | null,
  stance: CombatantStance,
): boolean {
  if (!isHunterJob(ctx.content, jobType)) return false;
  if (stance.ordered || world.has(e, Engagement)) return false;
  const rest = world.tryGet(e, HuntRest);
  if (rest === undefined) return false;
  if (ctx.tick < rest.until) return true;
  world.remove(e, HuntRest);
  return false;
}
