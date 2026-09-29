import { type LightningStrike, thunderDelaySeconds } from '@open-northland/render/data';
import { clamp, lerp, lerpHz } from '../math.js';

/**
 * Thunder for each lightning strike, played once. The original has no lightning or thunder; every
 * constant here is an approximation of real thunder, compressed to game pacing.
 */

/** One swell of the rumble's rolling amplitude, `atS` after the thunder starts. */
export interface ThunderRoll {
  readonly atS: number;
  readonly gain: number;
}

/** How one strike's thunder sounds and when it arrives. */
export interface ThunderPlan {
  readonly strikeId: number;
  /** Game seconds the sound reaches the listener. */
  readonly arriveSeconds: number;
  /** Peak of the low-passed noise burst a near strike opens with; 0 for a distant one. */
  readonly crackGain: number;
  /** Low-pass over the rumble: distance swallows the highs. */
  readonly lowpassHz: number;
  /** How long the rumble rolls. */
  readonly rumbleS: number;
  /** Rolling amplitude swells in time order; the rumble fades to silence after the last. */
  readonly rolls: readonly ThunderRoll[];
}

/** Strikes nearer than this open with a crack. Approximation. */
export const THUNDER_CRACK_DISTANCE = 0.3;
/** Crack peak overhead, in dB of the rumble peak it opens. Approximation. */
export const THUNDER_CRACK_OVER_RUMBLE_DB = -2;
/** Rumble peak level overhead and far away, dB of linear gain into the weather bus. Approximation,
 *  measured so the nearest strike peaks near -12 dBFS and a far one under -28. */
export const THUNDER_RUMBLE_NEAR_DB = -9;
export const THUNDER_RUMBLE_FAR_DB = -21;
/** Rumble low-pass overhead and far away: real thunder carries most energy under 200 Hz. */
export const THUNDER_NEAR_LOWPASS_HZ = 320;
export const THUNDER_FAR_LOWPASS_HZ = 110;
/** Rumble length overhead and far away: distant thunder rolls longer. Approximation. */
export const THUNDER_NEAR_RUMBLE_S = 5;
export const THUNDER_FAR_RUMBLE_S = 8;
/** Rolling swells per rumble, inclusive range. */
export const THUNDER_MIN_ROLLS = 3;
export const THUNDER_MAX_ROLLS = 6;
/** Swell `i` peaks at `peak * THUNDER_ROLL_DECAY^i`, times a random share of at least
 *  {@link THUNDER_ROLL_FLOOR}, so the rumble rolls up and down while it dies away. */
export const THUNDER_ROLL_DECAY = 0.8;
export const THUNDER_ROLL_FLOOR = 0.4;
/** Swells spread over this share of the rumble, each jittered by up to this share of its slot; the
 *  rest is the fading tail. */
export const THUNDER_ROLL_SPAN = 0.5;
export const THUNDER_ROLL_JITTER = 0.8;
/** The first swell lands this early near and this late far (a far rumble builds slowly). */
export const THUNDER_NEAR_ONSET_S = 0.15;
export const THUNDER_FAR_ONSET_S = 1.2;
/** A strike first seen after its thunder should already have sounded by more than this is skipped
 *  (weather switched on mid-storm, a load), so no backlog of thunder plays at once. */
export const THUNDER_STALE_S = 0.5;
/** Game time moving back more than this (a new map, a replay) forgets every heard strike. */
export const THUNDER_CLOCK_RESET_S = 1;
/** At most this many thunders wait for their sound to arrive; more strikes are dropped. */
export const THUNDER_MAX_PENDING = 8;

/** A small deterministic [0, 1) generator (mulberry32), so a strike always rolls the same way. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}

function dbToGain(db: number): number {
  return 10 ** (db / 20);
}

/** Plan one strike's thunder; `random` shapes the rolls, so the plan is testable and repeatable. */
export function planThunder(strike: LightningStrike, random: () => number): ThunderPlan {
  const distance = clamp(strike.distance, 0, 1);
  const rumbleS = lerp(THUNDER_NEAR_RUMBLE_S, THUNDER_FAR_RUMBLE_S, distance);
  const peak = dbToGain(lerp(THUNDER_RUMBLE_NEAR_DB, THUNDER_RUMBLE_FAR_DB, distance));
  const count = THUNDER_MIN_ROLLS + Math.floor(random() * (THUNDER_MAX_ROLLS - THUNDER_MIN_ROLLS + 1));
  const onsetS = lerp(THUNDER_NEAR_ONSET_S, THUNDER_FAR_ONSET_S, distance);
  const slot = (rumbleS * THUNDER_ROLL_SPAN) / count;
  const rolls: ThunderRoll[] = [{ atS: onsetS, gain: peak }];
  for (let i = 1; i < count; i++) {
    rolls.push({
      atS: onsetS + slot * (i + random() * THUNDER_ROLL_JITTER),
      gain: peak * THUNDER_ROLL_DECAY ** i * lerp(THUNDER_ROLL_FLOOR, 1, random()),
    });
  }
  return {
    strikeId: strike.id,
    arriveSeconds: strike.atSeconds + thunderDelaySeconds(strike),
    crackGain:
      distance < THUNDER_CRACK_DISTANCE
        ? peak * dbToGain(THUNDER_CRACK_OVER_RUMBLE_DB) * (1 - distance / THUNDER_CRACK_DISTANCE)
        : 0,
    lowpassHz: lerpHz(THUNDER_NEAR_LOWPASS_HZ, THUNDER_FAR_LOWPASS_HZ, distance),
    rumbleS,
    rolls,
  };
}

/**
 * Hears each strike once and releases its thunder when game time reaches the sound's arrival, so a
 * paused game holds pending thunder and a replay repeats it.
 */
export class ThunderQueue {
  private readonly heard = new Set<number>();
  private pending: ThunderPlan[] = [];
  private lastSeconds = Number.NEGATIVE_INFINITY;

  /** Admit this frame's strikes and return the thunders due by `gameSeconds`, oldest first. */
  advance(strikes: readonly LightningStrike[], gameSeconds: number): readonly ThunderPlan[] {
    if (gameSeconds < this.lastSeconds - THUNDER_CLOCK_RESET_S) this.clear();
    this.lastSeconds = gameSeconds;
    for (const strike of strikes) {
      if (this.heard.has(strike.id)) continue;
      this.heard.add(strike.id);
      const plan = planThunder(strike, seededRandom(strike.id));
      if (plan.arriveSeconds < gameSeconds - THUNDER_STALE_S) continue;
      if (this.pending.length >= THUNDER_MAX_PENDING) continue;
      this.pending.push(plan);
    }
    this.forgetGone(strikes);
    if (this.pending.length === 0) return [];
    const due = this.pending.filter((p) => p.arriveSeconds <= gameSeconds);
    if (due.length > 0) this.pending = this.pending.filter((p) => p.arriveSeconds > gameSeconds);
    return due.sort((a, b) => a.arriveSeconds - b.arriveSeconds);
  }

  /** Drop everything heard and pending (weather switched off). */
  clear(): void {
    this.heard.clear();
    this.pending = [];
    this.lastSeconds = Number.NEGATIVE_INFINITY;
  }

  /** How many thunders wait for their sound to arrive. */
  get pendingCount(): number {
    return this.pending.length;
  }

  /** Forget ids the render no longer lists, so the heard set stays as small as the strike list. */
  private forgetGone(strikes: readonly LightningStrike[]): void {
    if (this.heard.size <= strikes.length) return;
    for (const id of this.heard) {
      if (!strikes.some((s) => s.id === id)) this.heard.delete(id);
    }
  }
}
