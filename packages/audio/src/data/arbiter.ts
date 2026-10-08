import { Rng } from '@open-northland/sim';
import {
  JINGLE_CIVIL_DEFENSE,
  JINGLE_DEATH,
  JINGLE_HOUSE_BUILT,
  JINGLE_LOST,
  JINGLE_OPEN_CHEST,
  JINGLE_TECHNOLOGY,
  JINGLE_WON,
} from './bindings.js';
import { OneShotLedger, type OneShotPlayback } from './one-shot-ledger.js';
import type { OneShot } from './types.js';

/**
 * Rations one frame's decided one-shots so a late-game screen stays legible: the director says what
 * happened, the arbiter says how much of it the ear can take. Three lanes ({@link Lane}):
 *
 * - Jingles ring one at a time, in priority order. A type still ringing swallows its repeat (original
 *   behavior: a jingle already sounding is not started again). A type that keeps firing earns a growing
 *   cooldown, so the tenth birth in a row is a reminder every minute while the first birth after a
 *   quiet spell rings at once. A more important jingle (a death, the alarm) rings over a lesser one
 *   already sounding; a lesser one waits for the lane and rings late, or is dropped once stale.
 * - Voices and positioned SFX draw from a rate budget each, loudest first, so the busiest battle
 *   starts a bounded number of layered sounds a second.
 *
 * Every shot but a jingle has its wav picked here, and is refused before it costs any budget when its
 * key is cooling or, being exclusive, its wav (an answer: its pool) still sounds. The engine receives
 * only shots that should play, each with its one wav.
 *
 * Approximation: the original rations nothing beyond its same-jingle and same-wav guards; the budgets
 * and the growing cooldown are a legibility choice. Pure: time comes in as `now` (audio-clock
 * seconds) and the wav picks draw from an injected source.
 */

/** The rank a jingle rings with: a higher rank interrupts the lane, a lower or equal one waits. */
export const JINGLE_PRIORITY: ReadonlyMap<number, number> = new Map([
  [JINGLE_WON, 4],
  [JINGLE_LOST, 4],
  [JINGLE_CIVIL_DEFENSE, 3],
  [JINGLE_DEATH, 2],
  [JINGLE_TECHNOLOGY, 1],
  [JINGLE_HOUSE_BUILT, 1],
  [JINGLE_OPEN_CHEST, 1],
]);
/** The rank of a jingle the table leaves out (a birth, a marriage, a custom bank's type). */
export const DEFAULT_JINGLE_PRIORITY = 0;
/** How long a jingle without a music-duck hold is taken to ring, in seconds. */
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

function jinglePriority(musicType: number): number {
  return JINGLE_PRIORITY.get(musicType) ?? DEFAULT_JINGLE_PRIORITY;
}

function jingleLengthS(shot: OneShot): number {
  return shot.duckMusicMs === undefined ? DEFAULT_JINGLE_LENGTH_S : shot.duckMusicMs / 1000;
}

function jingleType(shot: OneShot): number | null {
  return shot.lane?.kind === 'jingle' ? shot.lane.musicType : null;
}

/** {@link OneShotArbiter} construction options, all optional for a headless run. */
export interface ArbiterOptions {
  /** Audio-clock second the budgets start full at. */
  readonly now?: number;
  /** The [0,1) source wav picks draw from; absent, a fixed-seed sequence, so the layer stays pure. */
  readonly random?: () => number;
  /** What the engine reports back. */
  readonly playback?: OneShotPlayback;
}

export class OneShotArbiter {
  private readonly types = new Map<number, JingleTypeState>();
  private readonly pending = new Map<number, PendingJingle>();
  /** When the jingle lane frees, and the rank of the jingle holding it. */
  private laneBusyUntil = Number.NEGATIVE_INFINITY;
  private lanePriority = DEFAULT_JINGLE_PRIORITY;
  private readonly voices: RateBudget;
  private readonly sfx: RateBudget;
  private readonly ledger: OneShotLedger;

  constructor(options: ArbiterOptions = {}) {
    const now = options.now ?? 0;
    this.voices = new RateBudget(VOICE_STARTS_PER_S, VOICE_BURST, now);
    this.sfx = new RateBudget(SFX_STARTS_PER_S, SFX_BURST, now);
    const random = options.random ?? seededRandom(DEFAULT_PICK_SEED);
    this.ledger = new OneShotLedger(random, options.playback ?? {});
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
          jingles.push(shot);
          break;
        case 'voice':
        case 'sfx':
          this.ledger.offer(shot, now);
          break;
        case undefined: {
          const started = this.ledger.startFree(shot, now);
          if (started !== null) out.push(started);
          break;
        }
      }
    }
    jingles.sort((a, b) => jinglePriority(jingleType(b) ?? 0) - jinglePriority(jingleType(a) ?? 0));
    for (const shot of jingles) this.offerJingle(shot, now, out);
    this.ringPending(now, out);
    for (const shot of this.ledger.takeCandidates()) {
      const budget = shot.lane?.kind === 'voice' ? this.voices : this.sfx;
      if (!budget.ready(now)) continue;
      const started = this.ledger.startWorld(shot, now);
      if (started === null) continue;
      budget.spend();
      out.push(started);
    }
    return out;
  }

  private offerJingle(shot: OneShot, now: number, out: OneShot[]): void {
    const type = jingleType(shot);
    if (type === null) return;
    const state = this.types.get(type);
    if (state !== undefined && now < state.lastRing + state.cooldownS) return; // folded into the last ring
    if (now < this.laneBusyUntil && jinglePriority(type) <= this.lanePriority) {
      this.pending.set(type, { shot, since: now }); // the latest instance waits; earlier ones fold into it
      return;
    }
    this.ring(shot, type, now, out);
  }

  private ring(shot: OneShot, type: number, now: number, out: OneShot[]): void {
    const length = jingleLengthS(shot);
    const state = this.types.get(type) ?? { lastRing: Number.NEGATIVE_INFINITY, cooldownS: length };
    const frequent = now - state.lastRing < state.cooldownS * JINGLE_FREQUENT_WINDOW;
    state.cooldownS = frequent
      ? Math.min(state.cooldownS * JINGLE_COOLDOWN_GROWTH, JINGLE_COOLDOWN_MAX_S)
      : length;
    state.lastRing = now;
    this.types.set(type, state);
    this.pending.delete(type);
    this.laneBusyUntil = now + length;
    this.lanePriority = jinglePriority(type);
    out.push(shot);
  }

  /** Once the lane is free, the highest-ranked fresh jingle still waiting rings; stale ones are dropped. */
  private ringPending(now: number, out: OneShot[]): void {
    if (this.pending.size === 0 || now < this.laneBusyUntil) return;
    let best: { readonly type: number; readonly waiting: PendingJingle } | null = null;
    for (const [type, waiting] of this.pending) {
      if (now - waiting.since > JINGLE_PENDING_MAX_AGE_S) {
        this.pending.delete(type);
        continue;
      }
      if (best === null || jinglePriority(type) > jinglePriority(best.type)) best = { type, waiting };
    }
    if (best === null) return;
    this.pending.delete(best.type);
    this.offerJingle(best.waiting.shot, now, out);
  }
}

function seededRandom(seed: number): () => number {
  const rng = new Rng(seed);
  return () => rng.next();
}
