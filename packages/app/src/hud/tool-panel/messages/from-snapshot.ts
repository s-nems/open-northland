import { isIndoorSettler } from '@open-northland/render/data';
import {
  type AtomicEffect,
  entityById,
  ONE,
  systems,
  TICKS_PER_SECOND,
  type WorldSnapshot,
} from '@open-northland/sim';
import {
  actorsOf,
  isFemale,
  needsRuleEnabled,
  num,
  ownerPlayerOf,
  type SnapshotEntity,
  settlerJobType,
  settlerNeedsOf,
  workplaceOf,
} from '../../../game/snapshot.js';
import { type MessageNaming, MessageRaiser, type RaisedMessage } from './raise.js';
import { USER_MESSAGE_TYPE } from './types.js';

/** Ticks between two sweeps of the snapshot for the conditions no sim event announces; the feed's
 *  duplicate check absorbs the repeats a condition that persists keeps raising. Approximation. */
export const SNAPSHOT_SWEEP_INTERVAL_TICKS = TICKS_PER_SECOND;

/** Sweeps a worker spends without work before the note, about ten seconds idle. Approximation. */
export const IDLE_SWEEPS_BEFORE_MESSAGE = 10;

const NO_MESSAGES: readonly RaisedMessage[] = [];

/** Hunger pinned at the top of the bar is starvation. */
const STARVING_HUNGER: number = ONE;

/** Share of the hitpoint pool at or below which a starving settler is close enough to death to warn
 *  about. Approximation on the starvation model's own beat: the bites left are worth about twenty
 *  seconds at 1x. */
const DYING_HEALTH_FRACTION = 10;

/** Atomics that occupy a settler without being work: a paired chat or a stagger. */
const EFFECTLESS_ATOMICS: ReadonlySet<AtomicEffect['kind']> = new Set<AtomicEffect['kind']>(['idle']);

/** What a settler is doing, as far as the note about having no work is concerned. */
type Occupation = 'idle' | 'walking' | 'busy';

export interface SnapshotMessageSource {
  /** The messages due at this snapshot; empty between sweeps. */
  sweep(snapshot: WorldSnapshot, naming: MessageNaming): readonly RaisedMessage[];
}

type Components = SnapshotEntity['components'];

function isEffectlessAtomic(components: Components): boolean {
  const atomic = components.CurrentAtomic as { effect?: { kind?: unknown } } | undefined;
  const kind = atomic?.effect?.kind;
  return typeof kind === 'string' && EFFECTLESS_ATOMICS.has(kind as AtomicEffect['kind']);
}

/**
 * Approximation: a producer parked outside for missing inputs and a gatherer whose resource ran out carry
 * no component either and read as idle, so they get this note in place of one naming the missing good.
 */
function occupationOf(snapshot: WorldSnapshot, e: SnapshotEntity): Occupation {
  const c = e.components;
  if (c.PlayerOrder !== undefined || c.Garrison !== undefined || isIndoorSettler(snapshot, c)) return 'busy';
  if (c.CurrentAtomic !== undefined) return isEffectlessAtomic(c) ? 'idle' : 'busy';
  if (c.PathFollow !== undefined || c.MoveGoal !== undefined) return 'walking';
  return 'idle';
}

/** A unit on a DEFEND stance stands still on purpose. */
function holdsPost(e: SnapshotEntity): boolean {
  const stance = e.components.Stance as { mode?: unknown } | undefined;
  return num(stance?.mode) === systems.MILITARY_MODE.DEFEND;
}

/** True for a settler employed at a standing building; waiting for one still going up is by design. */
function hasWorkplaceToWorkAt(snapshot: WorldSnapshot, e: SnapshotEntity): boolean {
  const workplace = workplaceOf(e);
  if (workplace === undefined) return false;
  const building = entityById(snapshot, workplace);
  return building !== undefined && building.components.UnderConstruction === undefined;
}

/** Adults only; a child's needs never raise a note. */
function isLocalAdult(e: SnapshotEntity, localPlayer: number): boolean {
  return (
    e.components.Person !== undefined && e.components.Age === undefined && ownerPlayerOf(e) === localPlayer
  );
}

/** Consecutive sweeps each employed worker has spent without work. */
class IdleStreaks {
  private counts = new Map<number, number>();
  private next = new Map<number, number>();

  begin(): void {
    this.next = new Map();
  }

  /** An idle sweep adds one, a walk keeps the count; returns the count after this sweep. */
  advance(entity: number, occupation: 'idle' | 'walking'): number {
    const count = (this.counts.get(entity) ?? 0) + (occupation === 'idle' ? 1 : 0);
    this.next.set(entity, count);
    return count;
  }

  /** A worker not advanced this sweep, busy or gone, starts over. */
  end(): void {
    this.counts = this.next;
  }
}

/** Hitpoints left of the pool, or undefined for a settler carrying none. */
function healthOf(e: SnapshotEntity): { hitpoints: number; max: number } | undefined {
  const health = e.components.Health as { hitpoints?: unknown; max?: unknown } | undefined;
  const hitpoints = num(health?.hitpoints);
  const max = num(health?.max);
  return hitpoints === undefined || max === undefined ? undefined : { hitpoints, max };
}

/** A starving settler whose pool has nearly run out; the sim bites it every few ticks until it dies. */
function isDying(e: SnapshotEntity): boolean {
  const health = healthOf(e);
  return (
    health !== undefined && health.hitpoints > 0 && health.hitpoints * DYING_HEALTH_FRACTION <= health.max
  );
}

/** A jobless adult is never planned, so nothing feeds it and its bars pin without consequence. */
function isJobless(e: SnapshotEntity): boolean {
  return settlerJobType(e) === undefined;
}

/** Each note fires at the level the reserve table sets aside for marking a need to the player, which is
 *  the same level the original reads before raising these very messages. */
function raiseNeeds(raiser: MessageRaiser, e: SnapshotEntity): void {
  const needs = settlerNeedsOf(e);
  if (needs === undefined || isJobless(e)) return;
  const alert = systems.NEED_CRITICAL_THRESHOLD;
  if (needs.hunger >= alert) raiser.settler(USER_MESSAGE_TYPE.hungry, e);
  if (needs.hunger >= STARVING_HUNGER) {
    raiser.settler(USER_MESSAGE_TYPE.starving, e);
    if (isDying(e)) raiser.settler(USER_MESSAGE_TYPE.willDie, e);
  }
  if (needs.fatigue >= alert) raiser.settler(USER_MESSAGE_TYPE.tired, e);
  if (needs.piety >= alert) raiser.settler(USER_MESSAGE_TYPE.wantsToPray, e);
}

function raiseNothingToDo(
  raiser: MessageRaiser,
  snapshot: WorldSnapshot,
  e: SnapshotEntity,
  streaks: IdleStreaks,
): void {
  // The original drops this note for a woman, whose work is the household rather than a trade.
  if (isFemale(e) || holdsPost(e) || !hasWorkplaceToWorkAt(snapshot, e)) return;
  const occupation = occupationOf(snapshot, e);
  if (occupation === 'busy') return;
  if (streaks.advance(e.id, occupation) >= IDLE_SWEEPS_BEFORE_MESSAGE) {
    raiser.settler(USER_MESSAGE_TYPE.nothingToDo, e);
  }
}

/**
 * The local player's messages read off the snapshot itself: pressing needs and a worker with nothing to
 * do. One pass over the actors per sweep interval, so the cost is bounded by the seat's population and
 * the cadence, not by the frame rate.
 */
export function createSnapshotMessageSource(localPlayer: number): SnapshotMessageSource {
  let lastSweepTick: number | null = null;
  const streaks = new IdleStreaks();
  return {
    sweep: (snapshot, naming) => {
      if (lastSweepTick !== null && snapshot.tick - lastSweepTick < SNAPSHOT_SWEEP_INTERVAL_TICKS)
        return NO_MESSAGES;
      lastSweepTick = snapshot.tick;
      const raiser = new MessageRaiser(snapshot, naming);
      const needsOn = needsRuleEnabled(snapshot);
      streaks.begin();
      for (const e of actorsOf(snapshot)) {
        if (!isLocalAdult(e, localPlayer)) continue;
        if (needsOn) raiseNeeds(raiser, e);
        raiseNothingToDo(raiser, snapshot, e, streaks);
      }
      streaks.end();
      return raiser.out;
    },
  };
}
