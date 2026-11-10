import {
  CurrentAtomic,
  chatHoldsSettler,
  computerControllerRuns,
  FamilyDuty,
  IdleStand,
  isMachinePlayer,
  MoveGoal,
  ownerOf,
  Resting,
} from '../../../components/index.js';
import { TICKS_PER_SECOND } from '../../../core/loop.js';
import type { Entity, World } from '../../../ecs/world.js';
import { assignedWorkers } from '../../stores/assigned-workers.js';
import { ECONOMY_HOLD_MARKERS } from '../action-owner.js';
import { cutOffCheckTick } from '../drives/cut-off.js';

/**
 * How often an idle adult, or one waiting inside a building, re-runs its drive ladder, staggered by the id
 * of {@link beatKeyOf} so the idle population spreads over the period. Such a settler therefore takes up
 * new work up to this late. Approximation chosen for cost: the original's idle retry cadence is not
 * readable.
 */
export const IDLE_REPLAN_PERIOD_TICKS = 2 * TICKS_PER_SECOND;

/** {@link IDLE_REPLAN_PERIOD_TICKS} for the adults of a seat a computer controller runs, which also wait out an economy hold
 *  on this beat. A deliberate cost cut, not fidelity: a computer settler takes up new work, or answers a
 *  need under a hold, up to this late, which buys planner time on maps crowded with computer seats. */
export const COMPUTER_IDLE_REPLAN_PERIOD_TICKS = 8 * TICKS_PER_SECOND;

/** The idle re-plan period of `e`'s seat: the computer one while a computer controller runs its owner.
 *  Reads only the AiControl store, whose generations the planner sweep watches. */
export function idleReplanPeriodOf(world: World, e: Entity): number {
  const owner = ownerOf(world, e);
  return owner !== undefined && computerControllerRuns(world, owner)
    ? COMPUTER_IDLE_REPLAN_PERIOD_TICKS
    : IDLE_REPLAN_PERIOD_TICKS;
}

/** The period idle `e` re-plans on: its seat's, unless its {@link IdleStand} asked for the short beat.
 *  Reads only IdleStand, re-added whenever its fields change, and AiControl, both watched by the sweep. */
export function idleStandPeriodOf(world: World, e: Entity): number {
  return world.tryGet(e, IdleStand)?.shortBeat === true
    ? IDLE_REPLAN_PERIOD_TICKS
    : idleReplanPeriodOf(world, e);
}

/** Whether `e`, held off the economy, waits its hold out on its idle beat instead of re-planning every
 *  tick: a computer seat's settler held only by a family duty or a company chat. The duty's and the
 *  chat's own systems still walk it, and a walk or clip they give it wakes it on its next visit. */
export function waitsHoldOnBeat(world: World, e: Entity): boolean {
  return (
    idleReplanPeriodOf(world, e) === COMPUTER_IDLE_REPLAN_PERIOD_TICKS &&
    (world.has(e, FamilyDuty) || chatHoldsSettler(world, e)) &&
    !heldByBeatBlockingHold(world, e)
  );
}

/** Whether `e` belongs to a machine seat, computer or map AI. */
export function ownedByMachine(world: World, e: Entity): boolean {
  const owner = ownerOf(world, e);
  return owner !== undefined && isMachinePlayer(world, owner);
}

/** Whether `e`, a machine seat's settler that its ladder left holding still with no walk or clip, waits
 *  for its idle beat instead of re-planning every tick. A cost cut, not fidelity: it takes up new work or
 *  answers a need up to its seat's idle period late; a move, clip or order wakes it. */
export function standsStillForMachine(world: World, e: Entity): boolean {
  return ownedByMachine(world, e) && !world.has(e, MoveGoal) && !world.has(e, CurrentAtomic);
}

/** Every economy hold but the family duty: any of them keeps the settler re-planning every tick. */
const BEAT_BLOCKING_HOLDS = ECONOMY_HOLD_MARKERS.filter((marker) => marker !== FamilyDuty);

function heldByBeatBlockingHold(world: World, e: Entity): boolean {
  for (const marker of BEAT_BLOCKING_HOLDS) if (world.has(e, marker)) return true;
  return false;
}

/** Whether `tick` is one on which an idler keyed on `key` re-plans under `period`. */
export function idleReplanDue(tick: number, key: Entity, period: number): boolean {
  return (tick + key) % period === 0;
}

/** The entity whose beat idle `e` re-plans on: the building it waits inside, so a workshop's crew
 *  re-plans in one pass and hands its seats out together, else `e` itself. */
export function beatKeyOf(world: World, e: Entity): Entity {
  return world.tryGet(e, Resting)?.at ?? e;
}

/** The beat of `period` an idler keyed on `key` re-plans on: {@link idleReplanDue} holds on the ticks
 *  whose {@link idleBeatOfTick} is this. */
export function idleBeatOf(key: Entity, period: number): number {
  return key % period;
}

export function idleBeatOfTick(tick: number, period: number): number {
  return (period - (tick % period)) % period;
}

/** Whether idle `e` skips its full ladder on `tick`. An alarm does not shorten the wait: between beats
 *  the sweep still visits an idler its owner's shelters may draw, for the shelter rung. A short-beat stand
 *  also re-plans on each cut-off check tick of its seat, so its work beyond its signposts is found on
 *  that cadence. */
export function waitsIdle(world: World, tick: number, e: Entity): boolean {
  const stand = world.tryGet(e, IdleStand);
  if (stand === undefined) return false;
  if (stand.shortBeat === true && cutOffCheckTick(tick, ownerOf(world, e))) return false;
  return !idleReplanDue(tick, beatKeyOf(world, e), idleStandPeriodOf(world, e));
}

/** End `e`'s idle wait, so it re-plans on the next pass: something moved it, or an order or errand
 *  addressed it. One waiting inside a building takes that building's crew with it, since the seats they
 *  hold there are handed out afresh. */
export function wakeIdle(world: World, e: Entity): void {
  if (!world.has(e, IdleStand)) return;
  world.remove(e, IdleStand);
  const at = world.tryGet(e, Resting)?.at;
  if (at !== undefined) wakeCrewInside(world, at);
}

/**
 * End the idle wait of a human seat's `e` whose need bar just reached a band threshold, where a needs
 * rung may fire, so it answers the need on this tick's pass instead of on its idle beat. It alone
 * re-plans: a crew it waits inside with keeps its seats. A machine seat's idler keeps its beat, the cost
 * cut {@link COMPUTER_IDLE_REPLAN_PERIOD_TICKS} names.
 */
export function wakeIdleToNeed(world: World, e: Entity): void {
  if (world.has(e, IdleStand) && !ownedByMachine(world, e)) world.remove(e, IdleStand);
}

/** Wake the workers waiting inside `workplace`, so they re-plan in one pass and re-pair its seats. */
export function wakeCrewInside(world: World, workplace: Entity): void {
  for (const e of assignedWorkers(world, workplace)) {
    if (world.tryGet(e, Resting)?.at === workplace) world.remove(e, IdleStand);
  }
}

/**
 * The verdict of the ladder run in progress: whether it left its adult idle, settled onto
 * {@link IdleStand} once the run ends. One slot serves the pass, since every drive stands only the
 * settler being planned. The marker is written only when it changes, so a long-idle settler costs no write.
 */
export class IdleStands {
  private entity: Entity | undefined;
  private standing = false;
  private shortBeat = false;

  /** Record that `e`'s ladder left it idle; `standing` says it reached the idle tail, `shortBeat` that it
   *  waits on {@link IDLE_REPLAN_PERIOD_TICKS} whatever its seat's period. */
  stand(e: Entity, standing: boolean, shortBeat = false): void {
    this.entity = e;
    this.standing = standing;
    this.shortBeat = shortBeat;
  }

  /** Mark `e` idle after its ladder ran, or wake it when the ladder found it something. */
  settle(world: World, e: Entity): void {
    if (this.entity !== e) {
      wakeIdle(world, e);
      return;
    }
    this.entity = undefined;
    const { standing, shortBeat } = this;
    const prior = world.tryGet(e, IdleStand);
    // A re-add, unlike an in-place write, reaches the sweep's feed, which files the idler by its period.
    if (prior?.standing !== standing || (prior.shortBeat === true) !== shortBeat) {
      world.add(e, IdleStand, shortBeat ? { standing, shortBeat } : { standing });
    }
  }
}
