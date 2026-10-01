import { isIndoorSettler } from '@open-northland/render/data';
import {
  type AtomicEffect,
  components,
  entityById,
  ONE,
  systems,
  TICKS_PER_SECOND,
  type WorkStatus,
  type WorldSnapshot,
} from '@open-northland/sim';
import { isSoldierJob } from '../../../catalog/professions.js';
import {
  actorsOf,
  type ChildOrderWait,
  childOrderWaitOf,
  healthOf,
  isAdult,
  isInvulnerable,
  marriageOf,
  needsRuleEnabled,
  num,
  ownerPlayerOf,
  type SnapshotEntity,
  settlerJobType,
  settlerNeedsOf,
  workFlagOf,
  workplaceOf,
} from '../../../game/snapshot.js';
import { idleReasonOf } from './idle-reasons.js';
import { type MessageNaming, MessageRaiser, type RaisedMessage } from './raise.js';
import { type IdleReason, USER_MESSAGE_TYPE } from './types.js';
import { type StallReader, type WorkshopSeam, WorkshopStalls } from './workshop-stalls.js';

/** Ticks between two sweeps of the snapshot for the conditions no sim event announces; the feed's
 *  duplicate check absorbs the repeats a condition that persists keeps raising. Approximation. */
export const SNAPSHOT_SWEEP_INTERVAL_TICKS = TICKS_PER_SECOND;

/** Sweeps a worker spends without work before the note, about ten seconds idle. Approximation. */
export const IDLE_SWEEPS_BEFORE_MESSAGE = 10;

/** Sweeps a child order's food search must keep missing before its note: one missed search is food
 *  still on its way more often than none in reach, and the search retries each second. Approximation. */
export const NO_FOOD_SWEEPS_BEFORE_MESSAGE = 5;

const NO_MESSAGES: readonly RaisedMessage[] = [];

/** Hunger pinned at the top of the bar is starvation. */
const STARVING_HUNGER: number = ONE;

/** Atomics that occupy a settler without being work, such as a paired chat. */
const EFFECTLESS_ATOMICS: ReadonlySet<AtomicEffect['kind']> = new Set<AtomicEffect['kind']>(['idle']);

/** What a settler is doing, as far as the note about having no work is concerned. */
export type Occupation = 'idle' | 'walking' | 'busy';

export interface SnapshotMessageSource {
  /** The messages due at this snapshot; empty between sweeps. */
  sweep(snapshot: WorldSnapshot, naming: MessageNaming): readonly RaisedMessage[];
  /** The seat's stalled workshops as the sweeps judged them; null without the workshop seam. */
  readonly stalls: StallReader | null;
}

type Components = SnapshotEntity['components'];

function isEffectlessAtomic(components: Components): boolean {
  const atomic = components.CurrentAtomic as { effect?: { kind?: unknown } } | undefined;
  const kind = atomic?.effect?.kind;
  return typeof kind === 'string' && EFFECTLESS_ATOMICS.has(kind as AtomicEffect['kind']);
}

/**
 * Approximation: a producer parked outside for missing inputs and a gatherer whose resource ran out carry
 * no component either and read as idle. A gatherer gets the idle note in place of one naming the missing
 * good; a craft workshop's operator leaves it to the stall note, which names it (`workshop-stalls.ts`).
 */
export function occupationOf(snapshot: WorldSnapshot, e: SnapshotEntity): Occupation {
  const c = e.components;
  if (c.PlayerOrder !== undefined || c.Garrison !== undefined || isIndoorSettler(snapshot, c)) return 'busy';
  if (c.CurrentAtomic !== undefined) return isEffectlessAtomic(c) ? 'idle' : 'busy';
  if (c.PathFollow !== undefined || c.MoveGoal !== undefined) return 'walking';
  return 'idle';
}

/** A unit on a DEFEND stance stands still on purpose. Added here: the original raises this note from a
 *  failed job attempt rather than from a poll, so it never has to tell standing still from idleness. */
export function holdsPost(e: SnapshotEntity): boolean {
  const stance = e.components.Stance as { mode?: unknown } | undefined;
  return num(stance?.mode) === systems.MILITARY_MODE.DEFEND;
}

/** True for a settler employed at a finished building; one waiting on a site still going up is working
 *  to plan. Quieter than the original, which asks only that the worker's house is not mid-upgrade and
 *  says nothing about employment. */
export function hasWorkplaceToWorkAt(snapshot: WorldSnapshot, e: SnapshotEntity): boolean {
  const workplace = workplaceOf(e);
  if (workplace === undefined) return false;
  const building = entityById(snapshot, workplace);
  return building !== undefined && building.components.UnderConstruction === undefined;
}

/** One of this seat's people; a child among them, since the sim starves children too. */
function isLocalPerson(e: SnapshotEntity, localPlayer: number): boolean {
  return e.components.Person !== undefined && ownerPlayerOf(e) === localPlayer;
}

/** One worker's run of workless sweeps, the post it held while running it up, and the last reason the
 *  sim gave for it. */
interface IdleStreak {
  readonly count: number;
  readonly atPost: boolean;
  reason: IdleReason | null;
}

/** Consecutive sweeps each worker has spent without work. */
class IdleStreaks {
  private counts = new Map<number, IdleStreak>();
  private next = new Map<number, IdleStreak>();

  begin(): void {
    this.next = new Map();
  }

  /** An idle sweep adds one and a walk keeps the count, but taking or losing a post starts the run
   *  over: the two notes this feeds ask different questions. Returns the count after this sweep. */
  advance(entity: number, occupation: 'idle' | 'walking', atPost: boolean): number {
    const before = this.counts.get(entity);
    const kept = before !== undefined && before.atPost === atPost ? before : undefined;
    const count = (kept?.count ?? 0) + (occupation === 'idle' ? 1 : 0);
    this.next.set(entity, { count, atPost, reason: kept?.reason ?? null });
    return count;
  }

  /** The reason this sweep's diagnosis gives for the run `advance` just counted. No answer keeps the
   *  last one: an ask still in flight, or a host cache that let the answer go, is not a new reason. */
  reason(entity: number, status: WorkStatus | undefined): IdleReason | null {
    const streak = this.next.get(entity);
    if (streak === undefined) return idleReasonOf(status);
    if (status !== undefined) streak.reason = idleReasonOf(status);
    return streak.reason;
  }

  /** A worker not advanced this sweep, busy or gone, starts over. */
  end(): void {
    this.counts = this.next;
  }
}

/** Consecutive sweeps each woman's child order has found no food, so a single missed search raises
 *  nothing. */
class FoodWaits {
  private counts = new Map<number, number>();
  private next = new Map<number, number>();

  begin(): void {
    this.next = new Map();
  }

  /** Count one more sweep of `entity` waiting on food; returns the run so far. */
  advance(entity: number): number {
    const count = (this.counts.get(entity) ?? 0) + 1;
    this.next.set(entity, count);
    return count;
  }

  /** A woman not advanced this sweep starts over. */
  end(): void {
    this.counts = this.next;
  }
}

/** Which of this seat's settlers have ever held a workplace, so the note about losing one can tell a
 *  razed post from a trade no workplace employs in the first place. Scoped to this mount, so a reload
 *  or a HUD rescale starts the history over and the note waits for the next post a settler loses. */
class PostHistory {
  private employed = new Set<number>();
  private seen = new Set<number>();

  /** Records this sweep's employment; returns whether the settler has held a post at some point. */
  track(entity: number, atPost: boolean): boolean {
    this.seen.add(entity);
    if (atPost) this.employed.add(entity);
    return this.employed.has(entity);
  }

  /** Forget the settlers gone from the world, so the set follows the seat's population. */
  end(): void {
    for (const entity of this.employed) {
      if (!this.seen.has(entity)) this.employed.delete(entity);
    }
    this.seen = new Set();
  }
}

/** A living settler whose pool has nearly run out, and that a script has not made unharmable. */
export function isDying(e: SnapshotEntity): boolean {
  const health = healthOf(e);
  return health !== undefined && !isInvulnerable(e) && systems.isNearDeath(health.hitpoints, health.max);
}

/** Share of the pool, per mille, a dying settler heals past the sim's near-death line before its note
 *  retires, so regeneration ticking across the line between blows does not flicker the card. On the
 *  5000 pool that is 250 hitpoints, about twenty seconds of regeneration. Approximation. */
export const DYING_NOTE_RETIRE_MARGIN_PER_MILLE = 50;
const PER_MILLE = 1000;

/** Whether a dying settler's note still stands: below the near-death line lifted by the retire margin. */
export function isStillDying(e: SnapshotEntity): boolean {
  const health = healthOf(e);
  if (health === undefined || isInvulnerable(e) || health.hitpoints <= 0) return false;
  const margin = Math.floor((health.max * DYING_NOTE_RETIRE_MARGIN_PER_MILLE) / PER_MILLE);
  return health.hitpoints <= margin || systems.isNearDeath(health.hitpoints - margin, health.max);
}

/** The sim's own lost marker, so a lost settler's note is back after a reload; the sim event that raised
 *  it first covers the seconds between sweeps. */
function isLost(e: SnapshotEntity): boolean {
  return e.components.LostWay !== undefined;
}

/** A jobless adult is never planned, so nothing feeds it and its bars pin without consequence. */
function isJobless(e: SnapshotEntity): boolean {
  return settlerJobType(e) === undefined;
}

/** Each note fires at the level the reserve table sets aside for marking a need to the player, which is
 *  the same level the original reads before raising these very messages. Only the heaviest hunger stage
 *  is raised; a dying settler's note stands in for both. */
function raiseNeeds(raiser: MessageRaiser, e: SnapshotEntity): void {
  const needs = settlerNeedsOf(e);
  if (needs === undefined || isJobless(e)) return;
  const alert = systems.NEED_CRITICAL_THRESHOLD;
  if (!isDying(e)) {
    if (needs.hunger >= STARVING_HUNGER) raiser.settler(USER_MESSAGE_TYPE.starving, e);
    else if (needs.hunger >= alert) raiser.settler(USER_MESSAGE_TYPE.hungry, e);
  }
  if (needs.fatigue >= alert) raiser.settler(USER_MESSAGE_TYPE.tired, e);
  if (needs.piety >= alert) raiser.settler(USER_MESSAGE_TYPE.wantsToPray, e);
}

/**
 * A settler close to death, whatever brought it there. The original reads the hitpoint margin alone, so
 * a wounded fighter is warned about as loudly as a starving one, and holds the note back for a
 * script-invulnerable settler and while one carries a healing draught. Approximation: the draught check
 * is left out, since a bearer drinks before falling to half its pool; only a draught put in its slot
 * after the wound, and not yet drunk, would have held the note back. The note retires on
 * {@link isStillDying}, past a margin above the line it is raised on.
 */
function raiseDying(raiser: MessageRaiser, e: SnapshotEntity): void {
  if (isDying(e)) raiser.settler(USER_MESSAGE_TYPE.willDie, e);
}

/**
 * A settler that held a workplace once and holds none now, with no flag yard standing in for it: what a
 * razed or released post leaves behind. Reading the loss rather than the bare absence keeps the note off
 * everyone no workplace ever employed, since the sim stamps every grown woman and civilian with a trade.
 * Approximation: the original raises this from a task that went looking for a work point and found none.
 * One note per settler, so razing a whole district fills the strip with the crews it put out of work.
 */
function lostItsWorkplace(e: SnapshotEntity, everEmployed: boolean): boolean {
  return everEmployed && workplaceOf(e) === undefined && workFlagOf(e) === undefined;
}

/**
 * A trader with a full route and no vehicle to command it from: the original's trader task idles
 * there with the `noVehicleForWork` note; this sim leaves the
 * trader on foot and the sweep reads the state off the route and the missing `Rider` marker.
 */
export function lacksTradeCart(e: SnapshotEntity): boolean {
  const route = e.components.TradeRoute as { stops?: unknown } | undefined;
  return (
    Array.isArray(route?.stops) &&
    route.stops.length >= components.TRADE_ROUTE_HOUSES &&
    e.components.Rider === undefined
  );
}

/** A soldier stands between orders by trade, and one taken off a tower lost no work to speak of. */
export function isSoldier(e: SnapshotEntity): boolean {
  const job = settlerJobType(e);
  return job !== undefined && isSoldierJob(job);
}

/** Whether the stall note speaks for this worker: its workshop runs no cycle, so the note naming why
 *  says more than one saying it has nothing to do. */
export function idleNoteHeldByStall(e: SnapshotEntity, stalls: StallReader | null): boolean {
  const workplace = workplaceOf(e);
  return workplace !== undefined && stalls?.holdsIdleNote(workplace) === true;
}

/** The note an idle adult earns: with a post to work at it has nothing to do, and names why; having
 *  lost one it has nowhere to go, and a trader without a cart cannot work its route. The diagnosis is
 *  asked once a sweep, from the sweep before the note, so the note's first text already has its answer. */
function raiseIdleNote(
  raiser: MessageRaiser,
  snapshot: WorldSnapshot,
  e: SnapshotEntity,
  streaks: IdleStreaks,
  posts: PostHistory,
  stalls: StallReader | null,
  workStatus: WorkshopSeam['workStatus'] | undefined,
): void {
  const atPost = workplaceOf(e) !== undefined;
  // Tracked ahead of the early-outs, since a settler is at its post precisely while it looks busy.
  const everEmployed = posts.track(e.id, atPost);
  if (holdsPost(e) || isSoldier(e)) return;
  const occupation = occupationOf(snapshot, e);
  if (occupation === 'busy') return;
  const count = streaks.advance(e.id, occupation, atPost);
  const due = count >= IDLE_SWEEPS_BEFORE_MESSAGE;
  if (hasWorkplaceToWorkAt(snapshot, e)) {
    if (count < IDLE_SWEEPS_BEFORE_MESSAGE - 1 || idleNoteHeldByStall(e, stalls)) return;
    const reason = streaks.reason(e.id, workStatus?.(e.id));
    if (due) raiser.idle(e, reason);
  } else if (!due) return;
  else if (lostItsWorkplace(e, everEmployed)) raiser.settler(USER_MESSAGE_TYPE.workplaceNotFound, e);
  else if (lacksTradeCart(e)) raiser.settler(USER_MESSAGE_TYPE.noVehicleForWork, e);
}

/** The child-order wait a note reports. The assistant's booking waiting on food is the assistant's to
 *  wait out, not an order the player gave, so only the panel shows it. */
export function familyNoteWaitOf(e: SnapshotEntity): ChildOrderWait | undefined {
  const wait = childOrderWaitOf(e);
  return wait === 'noFood' && e.components.AssistantChildOrder !== undefined ? undefined : wait;
}

/** A woman whose standing child order waits on something only the player can change; a food search
 *  must keep missing for {@link NO_FOOD_SWEEPS_BEFORE_MESSAGE} sweeps. */
function raiseFamilyBlock(
  raiser: MessageRaiser,
  snapshot: WorldSnapshot,
  e: SnapshotEntity,
  foodWaits: FoodWaits,
): void {
  const wait = familyNoteWaitOf(e);
  if (wait === undefined) return;
  if (wait === 'noFood' && foodWaits.advance(e.id) < NO_FOOD_SWEEPS_BEFORE_MESSAGE) return;
  const spouse = marriageOf(e)?.spouse;
  raiser.family(e, wait, spouse === undefined ? undefined : entityById(snapshot, spouse));
}

/**
 * The local player's messages read off the snapshot itself: pressing needs, a settler near death, an
 * idle worker, a child order that cannot start and, given `workshops`, a stalled workshop and the reason
 * an idle worker gives. One pass over
 * the world's actors per sweep interval, filtering to the seat inside the loop, so the cost follows the
 * actor count and the cadence rather than the frame rate.
 */
export function createSnapshotMessageSource(
  localPlayer: number,
  workshops?: WorkshopSeam,
): SnapshotMessageSource {
  let lastSweepTick: number | null = null;
  const streaks = new IdleStreaks();
  const posts = new PostHistory();
  const foodWaits = new FoodWaits();
  const stalls = workshops === undefined ? null : new WorkshopStalls(localPlayer, workshops);
  return {
    stalls,
    sweep: (snapshot, naming) => {
      const since = lastSweepTick === null ? null : snapshot.tick - lastSweepTick;
      // A tick that moved backwards (a reload behind the same source) sweeps rather than waiting forever.
      if (since !== null && since >= 0 && since < SNAPSHOT_SWEEP_INTERVAL_TICKS) return NO_MESSAGES;
      lastSweepTick = snapshot.tick;
      const raiser = new MessageRaiser(snapshot, naming);
      const needsOn = needsRuleEnabled(snapshot);
      // Ahead of the idle notes, which leave a stalled workshop's operators to its note.
      stalls?.sweep(snapshot, raiser, naming);
      streaks.begin();
      foodWaits.begin();
      for (const e of actorsOf(snapshot)) {
        if (!isLocalPerson(e, localPlayer)) continue;
        if (needsOn) raiseNeeds(raiser, e);
        raiseDying(raiser, e);
        if (isLost(e)) raiser.settler(USER_MESSAGE_TYPE.lostWithoutSignposts, e);
        raiseFamilyBlock(raiser, snapshot, e, foodWaits);
        // The original gates only this note on age, alongside its player-type and vehicle checks.
        if (isAdult(e)) raiseIdleNote(raiser, snapshot, e, streaks, posts, stalls, workshops?.workStatus);
      }
      streaks.end();
      foodWaits.end();
      posts.end();
      return raiser.out;
    },
  };
}
