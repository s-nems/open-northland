import { Rng } from '@open-northland/sim';
import type { AlertKind } from './alerts.js';
import {
  JINGLE_BIRTH,
  JINGLE_CIVIL_DEFENSE,
  JINGLE_DEATH,
  JINGLE_HOUSE_BUILT,
  JINGLE_LOST,
  JINGLE_MARRIAGE,
  JINGLE_OPEN_CHEST,
  JINGLE_TECHNOLOGY,
  JINGLE_WON,
} from './bindings.js';
import { OneShotLedger, type OneShotPlayback, type StopCause } from './one-shot-ledger.js';
import type { OneShot } from './types.js';

/**
 * Rations one frame's decided one-shots so a late-game screen stays legible: the director says what
 * happened, the arbiter says how much of it the ear can take. Three lanes ({@link Lane}):
 *
 * - Jingles and alerts ring one at a time, in priority order. A type still ringing swallows its repeat (original
 *   behavior: a jingle already sounding is not started again). A type that keeps firing earns a growing
 *   cooldown, so the tenth birth in a row is a reminder every minute while the first birth after a
 *   quiet spell rings at once. A more important jingle (a death, the alarm) rings over a lesser one
 *   already sounding; a lesser one waits for the lane and rings late, or is dropped once stale.
 * - Voices and positioned SFX draw from a rate budget each, loudest first, so the busiest battle
 *   starts a bounded number of layered sounds a second. Each sound pool starts at most its loudest shot
 *   a frame, holds a few instances at once, and the world as a whole a capped number
 *   ({@link OneShotLedger}).
 *
 * Every shot has its wav picked here, and is refused before it costs any budget when its key is cooling
 * or, being exclusive, every wav of its pool (an answer: any wav of it) still sounds. The engine
 * receives only shots that should play, each with its one wav, and fades out a world shot whose slot
 * a louder one steals.
 *
 * Approximation: the original rations nothing beyond its same-jingle and same-wav guards; the budgets,
 * caps and the growing cooldown are a legibility choice. Pure: time comes in as `now` (audio-clock
 * seconds) and the wav picks draw from an injected source.
 */

/**
 * The jingle and alert lane's ladder: a higher rank interrupts the lane, a lower or equal one waits for
 * it, so a birth never delays an alert. Authored, after the common RTS order of alerts.
 */
export const LANE_RANK = {
  /** The match decided. */
  critical: 5,
  /** The settlement attacked, or its alarm raised. */
  baseAttacked: 4,
  /** People attacked out in the field. */
  unitsAttacked: 3,
  /** The economy failing: hunger, idle hands, a death. */
  economy: 2,
  /** Something done: a building, a discovery, a birth, a wedding, a chest. */
  completion: 1,
} as const;

/** The rank a jingle rings with ({@link LANE_RANK}). */
export const JINGLE_PRIORITY: ReadonlyMap<number, number> = new Map([
  [JINGLE_WON, LANE_RANK.critical],
  [JINGLE_LOST, LANE_RANK.critical],
  [JINGLE_CIVIL_DEFENSE, LANE_RANK.baseAttacked],
  [JINGLE_DEATH, LANE_RANK.economy],
  [JINGLE_TECHNOLOGY, LANE_RANK.completion],
  [JINGLE_HOUSE_BUILT, LANE_RANK.completion],
  [JINGLE_OPEN_CHEST, LANE_RANK.completion],
  [JINGLE_BIRTH, LANE_RANK.completion],
  [JINGLE_MARRIAGE, LANE_RANK.completion],
]);
/** The rank an alert rings with ({@link LANE_RANK}). */
export const ALERT_PRIORITY: Readonly<Record<AlertKind, number>> = {
  baseAttacked: LANE_RANK.baseAttacked,
  unitsAttacked: LANE_RANK.unitsAttacked,
  hungry: LANE_RANK.economy,
  weary: LANE_RANK.economy,
};
/** The rank of a jingle the table leaves out (a custom bank's type): under everything ranked. */
export const DEFAULT_JINGLE_PRIORITY = 0;
/** How long a jingle without a music-duck hold, or an alert whose wav is not decoded yet, is taken to
 *  ring, in seconds. */
export const DEFAULT_JINGLE_LENGTH_S = 3;
/** A ring inside this many of the type's cooldowns since its last ring counts as frequent and grows the
 *  cooldown; a later one is fresh again and rings at the type's base cooldown (its own length). */
export const JINGLE_FREQUENT_WINDOW = 2;
/** A frequent type's cooldown multiplies by this each ring. */
export const JINGLE_COOLDOWN_GROWTH = 2;
/** The longest cooldown a frequent type grows into, in seconds: one reminder a minute. */
export const JINGLE_COOLDOWN_MAX_S = 60;
/** A jingle waiting for the lane rings only this long after its event; later it is stale and dropped. */
export const JINGLE_PENDING_MAX_AGE_S = 6;

/** Layered voice lines (chatter, animal calls, screams) started per second, and the burst allowed after
 *  a quiet spell. */
export const VOICE_STARTS_PER_S = 2;
export const VOICE_BURST = 2;
/** Layered positioned SFX (work cues, swings, impacts, crashes) started per second, and the burst. */
export const SFX_STARTS_PER_S = 12;
export const SFX_BURST = 12;

/** Seed of the pick source an arbiter built without one draws from. */
export const DEFAULT_PICK_SEED = 1;

/** The classic leaky budget: `tokens` refill at `rate` up to `burst`; a start spends one. */
class RateBudget {
  private tokens: number;
  private refilledAt: number;

  constructor(
    private readonly rate: number,
    private readonly burst: number,
    now: number,
  ) {
    this.tokens = burst;
    this.refilledAt = now;
  }

  /** Whether a start can be paid for at `now`, after refilling. */
  ready(now: number): boolean {
    const elapsed = Math.max(0, now - this.refilledAt);
    this.tokens = Math.min(this.burst, this.tokens + elapsed * this.rate);
    this.refilledAt = now;
    return this.tokens >= 1;
  }

  spend(): void {
    this.tokens -= 1;
  }
}

interface JingleTypeState {
  /** Audio-clock second of the last ring; -Infinity before the first. */
  lastRing: number;
  /** Seconds after `lastRing` during which a repeat is swallowed. */
  cooldownS: number;
}

interface PendingJingle {
  readonly shot: OneShot;
  readonly since: number;
}

/** A jingle-lane shot's type, which its cooldown and its waiting slot are kept under, and its rank. */
interface LaneType {
  readonly key: string;
  readonly rank: number;
}

function laneType(shot: OneShot): LaneType | null {
  const lane = shot.lane;
  if (lane?.kind === 'jingle') {
    return {
      key: `jingle:${lane.musicType}`,
      rank: JINGLE_PRIORITY.get(lane.musicType) ?? DEFAULT_JINGLE_PRIORITY,
    };
  }
  if (lane?.kind === 'alert') return { key: `alert:${lane.alert}`, rank: ALERT_PRIORITY[lane.alert] };
  return null;
}

function laneRank(shot: OneShot): number {
  return laneType(shot)?.rank ?? DEFAULT_JINGLE_PRIORITY;
}

/** {@link OneShotArbiter} construction options, all optional for a headless run. */
export interface ArbiterOptions {
  /** Audio-clock second the budgets start full at. */
  readonly now?: number;
  /** The [0,1) source wav picks draw from; absent, a fixed-seed sequence, so the layer stays pure. */
  readonly random?: () => number;
  /** What the engine reports back and lets the arbiter stop. */
  readonly playback?: OneShotPlayback;
}

export class OneShotArbiter {
  private readonly types = new Map<string, JingleTypeState>();
  private readonly pending = new Map<string, PendingJingle>();
  /** When the jingle lane frees, and the rank of the jingle holding it. */
  private laneBusyUntil = Number.NEGATIVE_INFINITY;
  private lanePriority = DEFAULT_JINGLE_PRIORITY;
  private readonly voices: RateBudget;
  private readonly sfx: RateBudget;
  private readonly ledger: OneShotLedger;
  private readonly playback: OneShotPlayback;
  /** The instances the running {@link decide} has started, and those of them it stopped again: the
   *  engine never hears of a shot both started and stopped in one decision. */
  private readonly startedNow = new Set<number>();
  private readonly droppedNow = new Set<number>();

  constructor(options: ArbiterOptions = {}) {
    const now = options.now ?? 0;
    this.voices = new RateBudget(VOICE_STARTS_PER_S, VOICE_BURST, now);
    this.sfx = new RateBudget(SFX_STARTS_PER_S, SFX_BURST, now);
    const random = options.random ?? seededRandom(DEFAULT_PICK_SEED);
    const playback = options.playback ?? {};
    this.playback = playback;
    const stop = playback.stop;
    this.ledger = new OneShotLedger(random, {
      ...(playback.clipLengthS !== undefined ? { clipLengthS: playback.clipLengthS } : {}),
      ...(stop !== undefined
        ? { stop: (instance: number, cause: StopCause) => this.stop(instance, cause, stop) }
        : {}),
    });
  }

  /** Stop a sounding instance through the engine, or drop one this decision started. */
  private stop(instance: number, cause: StopCause, engineStop: NonNullable<OneShotPlayback['stop']>): void {
    if (this.startedNow.has(instance)) this.droppedNow.add(instance);
    else engineStop(instance, cause);
  }

  private emit(out: OneShot[], shot: OneShot): void {
    if (shot.instance !== undefined) this.startedNow.add(shot.instance);
    out.push(shot);
  }

  /** The shots of this frame that should start, at `now` audio-clock seconds. Call every frame, with
   *  an empty list too: a jingle waiting for the lane rings from here. */
  decide(shots: readonly OneShot[], now: number): OneShot[] {
    this.ledger.beginFrame(now);
    const out: OneShot[] = [];
    const jingles: OneShot[] = [];
    for (const shot of shots) {
      switch (shot.lane?.kind) {
        case 'jingle':
        case 'alert':
          jingles.push(shot);
          break;
        case 'voice':
        case 'sfx':
          this.ledger.offer(shot, now);
          break;
        case undefined: {
          const started = this.ledger.startFree(shot, now);
          if (started !== null) this.emit(out, started);
          break;
        }
      }
    }
    jingles.sort((a, b) => laneRank(b) - laneRank(a));
    for (const shot of jingles) this.offerJingle(shot, now, out);
    this.ringPending(now, out);
    for (const shot of this.ledger.takeCandidates()) {
      const budget = shot.lane?.kind === 'voice' ? this.voices : this.sfx;
      if (!budget.ready(now)) continue;
      const started = this.ledger.startWorld(shot, now);
      if (started === null) continue;
      budget.spend();
      this.emit(out, started);
    }
    const kept =
      this.droppedNow.size === 0
        ? out
        : out.filter((shot) => shot.instance === undefined || !this.droppedNow.has(shot.instance));
    this.startedNow.clear();
    this.droppedNow.clear();
    return kept;
  }

  private offerJingle(shot: OneShot, now: number, out: OneShot[]): void {
    const type = laneType(shot);
    if (type === null || this.ledger.keyCooling(shot.key, now)) return;
    const state = this.types.get(type.key);
    if (state !== undefined && now < state.lastRing + state.cooldownS) return; // folded into the last ring
    if (now < this.laneBusyUntil && type.rank <= this.lanePriority) {
      this.pending.set(type.key, { shot, since: now }); // the latest instance waits; earlier ones fold into it
      return;
    }
    this.ring(shot, type, now, out);
  }

  /** How long a lane shot holds the lane: a jingle its music-duck hold, an alert its decoded wav. */
  private laneLengthS(shot: OneShot): number {
    if (shot.duckMusicMs !== undefined) return shot.duckMusicMs / 1000;
    const file = shot.lane?.kind === 'alert' && shot.files.length === 1 ? shot.files[0] : undefined;
    const decoded = file === undefined ? undefined : this.playback.clipLengthS?.(file);
    return decoded ?? DEFAULT_JINGLE_LENGTH_S;
  }

  private ring(shot: OneShot, type: LaneType, now: number, out: OneShot[]): void {
    const length = this.laneLengthS(shot);
    const state = this.types.get(type.key) ?? { lastRing: Number.NEGATIVE_INFINITY, cooldownS: length };
    const frequent = now - state.lastRing < state.cooldownS * JINGLE_FREQUENT_WINDOW;
    state.cooldownS = frequent
      ? Math.min(state.cooldownS * JINGLE_COOLDOWN_GROWTH, JINGLE_COOLDOWN_MAX_S)
      : length;
    state.lastRing = now;
    this.types.set(type.key, state);
    this.pending.delete(type.key);
    this.laneBusyUntil = now + length;
    this.lanePriority = type.rank;
    out.push(this.ledger.ring(shot, now));
  }

  /** Once the lane is free, the highest-ranked fresh jingle still waiting rings; stale ones are dropped. */
  private ringPending(now: number, out: OneShot[]): void {
    if (this.pending.size === 0 || now < this.laneBusyUntil) return;
    let best: { readonly key: string; readonly waiting: PendingJingle } | null = null;
    for (const [key, waiting] of this.pending) {
      if (now - waiting.since > JINGLE_PENDING_MAX_AGE_S) {
        this.pending.delete(key);
        continue;
      }
      if (best === null || laneRank(waiting.shot) > laneRank(best.waiting.shot)) best = { key, waiting };
    }
    if (best === null) return;
    this.pending.delete(best.key);
    this.offerJingle(best.waiting.shot, now, out);
  }
}

function seededRandom(seed: number): () => number {
  const rng = new Rng(seed);
  return () => rng.next();
}
