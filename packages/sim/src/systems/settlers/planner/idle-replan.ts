import { IdleStand, ownerOf } from '../../../components/index.js';
import { TICKS_PER_SECOND } from '../../../core/loop.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { ShelterSites } from '../../defence/index.js';

/**
 * How often an idle adult re-runs its drive ladder, staggered by entity id so the idle population spreads
 * over the period. An idle settler therefore takes up new work up to this late. Approximation chosen for
 * cost: the original's idle retry cadence is not readable.
 */
export const IDLE_REPLAN_PERIOD_TICKS = TICKS_PER_SECOND;

/** Whether `tick` is one on which idle `e` re-plans, given its period. */
export function idleReplanDue(tick: number, e: Entity, periodTicks = IDLE_REPLAN_PERIOD_TICKS): boolean {
  return (tick + e) % periodTicks === 0;
}

/**
 * The ticks between idle `e`'s ladder runs: the idle period, or every tick while its owner has buildings
 * on alarm, since taking shelter outranks every other drive.
 */
export function idleReplanPeriodTicks(world: World, shelters: ShelterSites, e: Entity): number {
  const owner = ownerOf(world, e);
  return owner !== undefined && shelters.has(owner) ? 1 : IDLE_REPLAN_PERIOD_TICKS;
}

/** Whether idle `e` skips its ladder on `tick`. */
export function waitsIdle(world: World, shelters: ShelterSites, tick: number, e: Entity): boolean {
  return world.has(e, IdleStand) && !idleReplanDue(tick, e, idleReplanPeriodTicks(world, shelters, e));
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
