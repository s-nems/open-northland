import { IdleStand } from '../../../components/index.js';
import { TICKS_PER_SECOND } from '../../../core/loop.js';
import type { Entity, World } from '../../../ecs/world.js';

/**
 * How often an idle adult re-runs its drive ladder, staggered by entity id so the idle population spreads
 * over the period. An idle settler therefore takes up new work up to this late. Approximation chosen for
 * cost: the original's idle retry cadence is not readable.
 */
export const IDLE_REPLAN_PERIOD_TICKS = TICKS_PER_SECOND;

/** Whether `tick` is one on which idle `e` re-plans. */
export function idleReplanDue(tick: number, e: Entity): boolean {
  return (tick + e) % IDLE_REPLAN_PERIOD_TICKS === 0;
}

/** The beat of the idle period `e` re-plans on: {@link idleReplanDue} holds on the ticks whose
 *  {@link idleBeatOfTick} is this. */
export function idleBeatOf(e: Entity): number {
  return e % IDLE_REPLAN_PERIOD_TICKS;
}

export function idleBeatOfTick(tick: number): number {
  return (IDLE_REPLAN_PERIOD_TICKS - (tick % IDLE_REPLAN_PERIOD_TICKS)) % IDLE_REPLAN_PERIOD_TICKS;
}

/** Whether idle `e` skips its full ladder on `tick`. An alarm does not shorten the wait: between beats
 *  the sweep still visits an idler its owner's shelters may draw, for the shelter rung alone. */
export function waitsIdle(world: World, tick: number, e: Entity): boolean {
  return world.has(e, IdleStand) && !idleReplanDue(tick, e);
}

/** End `e`'s idle wait, so it re-plans on the next pass: something moved it, or an order or errand
 *  addressed it. */
export function wakeIdle(world: World, e: Entity): void {
  world.remove(e, IdleStand);
}

/**
 * The adults whose ladder found them nothing to do this pass, settled onto {@link IdleStand} once each
 * ladder run ends. The marker is written only when it changes, so a long-idle settler costs no write.
 */
export class IdleStands {
  private readonly stood = new Map<Entity, boolean>();

  /** Record that `e`'s ladder left it idle; `standing` says it reached the idle tail. */
  stand(e: Entity, standing: boolean): void {
    this.stood.set(e, standing);
  }

  /** Whether `e`'s ladder reached its idle tail this pass. */
  reachedTail(e: Entity): boolean {
    return this.stood.get(e) === true;
  }

  /** Mark `e` idle after its ladder ran, or wake it when the ladder found it something. */
  settle(world: World, e: Entity): void {
    const standing = this.stood.get(e);
    if (standing === undefined) wakeIdle(world, e);
    else if (world.tryGet(e, IdleStand)?.standing !== standing) world.add(e, IdleStand, { standing });
  }
}
