import { type CurrentAtomic, Felling, MineDeposit, Resource } from '../../../../../components/index.js';
import { type Fixed, fx, ONE, ZERO } from '../../../../../core/fixed.js';
import type { Entity, World } from '../../../../../ecs/world.js';
import type { SystemContext } from '../../../../context.js';
import { workSpeedBonus } from '../../../../progression/bonus.js';

/**
 * Consecutive work swings a gatherer lands before standing its inter-swing breather.
 *
 * Observation: the original's collector swings a couple of times in a row, rests, then swings again. No
 * readable data field paces this, and a rest after every swing reads as a stutter.
 */
export const HARVEST_SWINGS_PER_REST = 2;

/**
 * Whether the swing that just resolved left its multi-swing job in progress. The executor then chains the
 * next swing directly, because the one-tick planner gap between swings draws a flick of the idle pose
 * mid-work.
 */
export function continuesHarvest(world: World, node: Entity): boolean {
  const res = world.tryGet(node, Resource);
  if (res === undefined) return false;
  const felling = world.tryGet(node, Felling);
  if (felling !== undefined) return felling.chopsLeft > 0;
  const deposit = world.tryGet(node, MineDeposit);
  // A trained swing can free a unit and bank a remainder at once. The executor releases on the extraction
  // result rather than this test, and the banked strikes persist across the pickup trip.
  if (deposit !== undefined) return deposit.strikes > 0;
  return (res.strikes ?? 0) > 0;
}

function restAfterHarvest(world: World, atomic: RestTailAtomic, node: Entity): boolean {
  if (!continuesHarvest(world, node)) return false;
  return (atomic.swingsSinceRest ?? 0) >= HARVEST_SWINGS_PER_REST;
}

/**
 * The idle breather a gatherer stands between work-swing bursts, in ticks (1.25 s at 12 ticks/s).
 *
 * Approximation: the readable data carries no rest field, since `atomicanimations.ini` lengths cover only
 * the swing itself.
 */
const HARVEST_REST_TICKS = 15;

type RestTailAtomic = Pick<
  NonNullable<(typeof CurrentAtomic)['__value']>,
  'duration' | 'restTail' | 'swingsSinceRest' | 'workCredit'
>;

/**
 * Hold a just-completed harvest swing open as its inter-swing breather, reporting whether the tail began.
 * The tail extends the same atomic rather than starting a second one, so render keeps the swing's binding.
 *
 * Invariant: `duration` carries {@link HARVEST_REST_TICKS} extra ticks exactly while `restTail` is set,
 * and {@link endRestTail} is the one reversal of both, or an inflated duration reaches `hashState()`.
 */
export function beginRestTail(world: World, atomic: RestTailAtomic, node: Entity): boolean {
  atomic.swingsSinceRest = (atomic.swingsSinceRest ?? 0) + 1;
  if (HARVEST_REST_TICKS <= 0 || !restAfterHarvest(world, atomic, node)) {
    if (!continuesHarvest(world, node)) delete atomic.swingsSinceRest; // the job's break resets the burst
    return false;
  }
  delete atomic.swingsSinceRest;
  atomic.duration += HARVEST_REST_TICKS;
  atomic.restTail = true;
  return true;
}

/** End a breather {@link beginRestTail} began, restoring the swing's own animation length and the
 *  component's exact pre-rest shape. */
export function endRestTail(atomic: RestTailAtomic): void {
  delete atomic.restTail;
  atomic.duration -= HARVEST_REST_TICKS;
}

/**
 * The whole work units the swing that just completed performs, `1 + workSpeedBonus`, with the fraction
 * banked on the atomic's `workCredit`. The atomic re-arms in place between swings, so the credit lives
 * exactly as long as the job. A whole credit deletes the field rather than storing zero, keeping an
 * unbonused atomic's component shape stable.
 */
export function swingWorkUnits(
  world: World,
  ctx: SystemContext,
  settler: Entity,
  atomic: { workCredit?: Fixed },
  goodType: number,
): number {
  const bonus = workSpeedBonus(world, ctx, settler, goodType);
  const credit = fx.add(atomic.workCredit ?? ZERO, fx.add(ONE, bonus));
  const whole = fx.toInt(credit);
  const rest = fx.sub(credit, fx.fromInt(whole));
  if (rest === ZERO) delete atomic.workCredit;
  else atomic.workCredit = rest;
  return whole;
}
