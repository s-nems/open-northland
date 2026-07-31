import { type CurrentAtomic, Felling, MineDeposit, Resource } from '../../../../../components/index.js';
import { type Fixed, fx, ONE, ZERO } from '../../../../../core/fixed.js';
import type { Entity, World } from '../../../../../ecs/world.js';
import type { SystemContext } from '../../../../context.js';
import { workSpeedBonus } from '../../../../progression/bonus.js';

/**
 * Consecutive work swings a gatherer lands before standing its inter-swing breather.
 *
 * source-basis (observed): the original's collector swings a couple of times in a row, then rests ~0.5–1 s,
 * then swings again. No readable data field paces this (the animations carry only the per-swing cycle), and
 * a rest after every swing reads as a stutter, so the breather lands only on every
 * {@link HARVEST_SWINGS_PER_REST}-th swing of a job still in progress ({@link restAfterHarvest}).
 */
export const HARVEST_SWINGS_PER_REST = 2;

/**
 * Whether the swing that just resolved against `node` left its multi-swing job still in progress — the
 * executor then chains the next swing (or the breather) directly instead of releasing the settler for a
 * tick, since the one-tick planner gap between swings draws a flick of the idle pose mid-work. True for a
 * standing {@link Felling} tree with chops left, and for any node mid-unit - a {@link MineDeposit} or a
 * multi-stroke bare node (`Resource.strikes`) with strokes advanced but the unit not yet loose; the swing
 * that fells / chips a unit loose / plucks / depletes releases the settler, and the planner routes the
 * pickup/carry - the job's natural break. A single-stroke plain node (a mushroom) never chains.
 */
export function continuesHarvest(world: World, node: Entity): boolean {
  const res = world.tryGet(node, Resource);
  if (res === undefined) return false; // felled/depleted/plucked - carrying is the break
  const felling = world.tryGet(node, Felling);
  if (felling !== undefined) return felling.chopsLeft > 0;
  const deposit = world.tryGet(node, MineDeposit);
  // A deposit is mid-unit while its strike counter is advanced. A trained swing can free a unit AND
  // bank a remainder here — the executor releases on the extraction result, not this test, and the
  // banked strikes persist on the node across the pickup trip.
  if (deposit !== undefined) return (deposit.strikes ?? 0) > 0;
  // A bare node mid-unit (the multi-stroke pluck, `Resource.strikes`) chains like a deposit does.
  return (res.strikes ?? 0) > 0;
}

/**
 * Whether the swing that just resolved against `node` should chain into the inter-swing breather: a
 * {@link continuesHarvest} job whose SETTLER has landed {@link HARVEST_SWINGS_PER_REST} swings since its
 * last breather (the atomic's own `swingsSinceRest`, counted by {@link beginRestTail} — a per-worker
 * count, since an experienced worker's swing advances the node's counters by more than one and their
 * parity no longer tracks swings). Off-boundary swings chain straight into the next swing instead.
 */
function restAfterHarvest(world: World, atomic: RestTailAtomic, node: Entity): boolean {
  if (!continuesHarvest(world, node)) return false;
  return (atomic.swingsSinceRest ?? 0) >= HARVEST_SWINGS_PER_REST;
}

/**
 * The idle breather a gatherer stands between work-swing bursts, in ticks (1.25 s at 12 ticks/s).
 *
 * source-basis (observed): the original's collector swings a couple of times in a row, rests ~0.5–1 s, and
 * swings again, but the readable data carries no rest field — `atomicanimations.ini` lengths cover only the
 * swing itself (its trailing idle pad is ~4 frames, far shorter).
 */
const HARVEST_REST_TICKS = 15;

type RestTailAtomic = Pick<
  NonNullable<(typeof CurrentAtomic)['__value']>,
  'duration' | 'restTail' | 'swingsSinceRest' | 'workCredit'
>;

/**
 * Hold a just-completed harvest swing open as its inter-swing breather when the settler's swing count
 * calls for one ({@link restAfterHarvest}), reporting whether the tail began; never after the final
 * swing (felled/depleted/plucked — the settler moves straight on to carrying).
 *
 * The tail is the SAME atomic extended, not a second one, so the render keeps the swing's binding and
 * stands its ready stance instead of snapping to another animation. Invariant: `duration` carries
 * {@link HARVEST_REST_TICKS} extra ticks exactly while `restTail` is set, and {@link endRestTail} is the
 * one reversal of both — the pair must stay matched or an inflated duration reaches `hashState()`.
 */
export function beginRestTail(world: World, atomic: RestTailAtomic, node: Entity): boolean {
  atomic.swingsSinceRest = (atomic.swingsSinceRest ?? 0) + 1;
  if (HARVEST_REST_TICKS <= 0 || !restAfterHarvest(world, atomic, node)) {
    if (!continuesHarvest(world, node)) delete atomic.swingsSinceRest; // the job's break resets the burst
    return false;
  }
  delete atomic.swingsSinceRest; // the breather closes this burst
  atomic.duration += HARVEST_REST_TICKS;
  atomic.restTail = true;
  return true;
}

/** End a breather {@link beginRestTail} began: drop the extra ticks and the marker, restoring the swing's
 *  own animation length and the component's exact pre-rest shape. */
export function endRestTail(atomic: RestTailAtomic): void {
  delete atomic.restTail;
  atomic.duration -= HARVEST_REST_TICKS;
}

/**
 * The whole work units the swing that just completed performs: `1 + workSpeedBonus` per swing, the
 * fraction banked on the atomic's `workCredit` across the multi-swing job (the atomic re-arms in place
 * between swings, so the credit lives exactly as long as the job). The gatherer half of the fewer-swings
 * rule (`scaledWorkRepeats`, progression/bonus.ts): a mastered swing counts double, each animation at
 * its natural length. A novice's credit stays whole, so its atomic keeps its historical component shape
 * (no `workCredit` field).
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
