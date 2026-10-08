import { pruneExpired } from './prune.js';
import type { OneShot } from './types.js';

/**
 * What the arbiter has started and when each start ends, on the audio clock: the wav it picked from a
 * pool, which wavs still sound, how many instances a pool holds, and the world one-shots that count
 * against {@link WORLD_VOICE_CAP}. Pure: the end of a play is its start plus the clip's length, asked of
 * the engine each time, so a play started before its wav decoded ends by the real length once it has;
 * until then the clip is taken to run {@link DEFAULT_CLIP_LENGTH_S}.
 */

/** Simultaneous instances one sound pool may hold (a scream pool, a swing pool). Approximation: the
 *  common 2-4 per-type cap; the original bounds a pool only by its one-buffer-per-wav rule. */
export const POOL_INSTANCE_CAP = 3;
/** Least seconds between two starts of one pool. Approximation: the common 50-100 ms retrigger floor. */
export const POOL_RETRIGGER_S = 0.08;
/** World one-shots (voice and sfx lanes) sounding at once. Approximation, to be benchmarked. */
export const WORLD_VOICE_CAP = 48;
/** An identical key restarts no sooner than this, so a burst of one emitter's events plays once, unless
 *  the shot names its own {@link OneShot.cooldownS}. Approximation: the common anti machine-gun window. */
export const KEY_COOLDOWN_S = 0.12;
/** The length a clip is taken to run before the engine has decoded it. Approximation: the median
 *  one-shot of the decoded bank runs 0.8-1.1 s. */
export const DEFAULT_CLIP_LENGTH_S = 1;
/** Wavs of a pool left free to pick from: the rest are the last ones played and wait their turn.
 *  Remembering all but one would freeze the order into a fixed loop after one round. */
export const NO_REPEAT_FREE_CHOICES = 2;
/** The key-cooldown and sounding maps sweep expired entries once they grow this large. */
export const LEDGER_PRUNE_SIZE = 512;
/** A world one-shot's playback rate varies by up to this fraction either way, which shifts its pitch
 *  and length together, so a pool of two wavs does not repeat the same two sounds. Approximation: the
 *  common 3-5 % per-play variation; the original plays every wav at its own rate. */
export const RATE_JITTER = 0.04;
/** A world one-shot's level varies by up to this many dB either way. Approximation, the common choice. */
export const GAIN_JITTER_DB = 1.5;

/** Why the arbiter stops a one-shot: a louder world shot took its slot, or an answer cut the
 *  yielding line before it ({@link OneShot.yieldsToAnswer}). */
export type StopCause = 'steal' | 'yield';

/**
 * What the arbiter asks of the playback engine, both optional so it runs headless. Without
 * `clipLengthS` every clip is taken to run {@link DEFAULT_CLIP_LENGTH_S}; without `stop` a stolen
 * one-shot keeps sounding to its end and only its slot is reused.
 */
export interface OneShotPlayback {
  /** The decoded length of `file` in seconds, or undefined while the engine has not decoded it. */
  readonly clipLengthS?: (file: string) => number | undefined;
  /** Fade out the one-shot started as `instance` ({@link OneShot.instance}), for `cause`. */
  readonly stop?: (instance: number, cause: StopCause) => void;
}

interface PoolState {
  /** The last wavs played from the pool, oldest first, which the next pick avoids. */
  readonly recent: string[];
  /** World instances of the pool still sounding. */
  playing: number;
  lastStart: number;
  /** The loudest world shot of the pool offered this frame, the only one that may start; null once taken. */
  candidate: OneShot | null;
}

/** One start of a wav, at a playback rate that stretches its length. */
interface Play {
  readonly file: string;
  readonly startedAt: number;
  readonly rate: number;
}

interface WorldVoice {
  readonly instance: number;
  readonly play: Play;
  readonly gain: number;
  readonly pool: PoolState;
}

/** How many of a pool's last wavs the next pick avoids: none for one wav, the other for two, and all
 *  but {@link NO_REPEAT_FREE_CHOICES} for a larger pool. */
export function noRepeatDepth(size: number): number {
  if (size <= 1) return 0;
  return Math.max(1, size - NO_REPEAT_FREE_CHOICES);
}

export class OneShotLedger {
  /** Pools by their file list: shots of one sound group share the index's array. */
  private readonly pools = new WeakMap<readonly string[], PoolState>();
  /** wav → its latest play. */
  private readonly lastPlay = new Map<string, Play>();
  /** A yielding line's play ({@link OneShot.yieldsToAnswer}) → the instance that stops it. */
  private readonly yielding = new WeakMap<Play, number>();
  /** key → audio-clock second its cooldown ends, set by its latest start. */
  private readonly keyReadyAt = new Map<string, number>();
  private readonly world: WorldVoice[] = [];
  /** The pools holding a candidate this frame, in offer order. */
  private readonly offered: PoolState[] = [];
  private nextInstance = 1;

  constructor(
    private readonly random: () => number,
    private readonly playback: OneShotPlayback,
  ) {}

  /** Retire the world one-shots that ended by `now`; call once per decided frame. */
  beginFrame(now: number): void {
    let kept = 0;
    for (const voice of this.world) {
      if (this.endOf(voice.play) > now) this.world[kept++] = voice;
      else voice.pool.playing--;
    }
    this.world.length = kept;
    pruneExpired(this.keyReadyAt, LEDGER_PRUNE_SIZE, (readyAt) => readyAt <= now);
    pruneExpired(this.lastPlay, LEDGER_PRUNE_SIZE, (play) => this.endOf(play) <= now);
  }

  /**
   * Offer a world shot, cheaply: one whose key is cooling, whose pool is full or just started, or whose
   * pool still sounds while it is group-exclusive is refused here. Of the rest, only the loudest of each
   * pool stays a candidate, since a pool starts at most once per {@link POOL_RETRIGGER_S}.
   */
  offer(shot: OneShot, now: number): void {
    if (shot.files.length === 0 || this.keyCooling(shot.key, now)) return;
    const pool = this.pool(shot.files);
    if (pool.playing >= POOL_INSTANCE_CAP || now - pool.lastStart < POOL_RETRIGGER_S) return;
    if (shot.exclusive === 'group' && this.anySounding(shot.poolFiles ?? shot.files, now)) return;
    if (pool.candidate === null) {
      pool.candidate = shot;
      this.offered.push(pool);
    } else if (shot.gain > pool.candidate.gain) {
      pool.candidate = shot;
    }
  }

  /** Each offered pool's candidate, loudest first, clearing them for the next lane or frame. */
  takeCandidates(): OneShot[] {
    const shots: OneShot[] = [];
    for (const pool of this.offered) {
      if (pool.candidate !== null) shots.push(pool.candidate);
      pool.candidate = null;
    }
    this.offered.length = 0;
    return shots.sort((a, b) => b.gain - a.gain);
  }

  /**
   * Start a pool's candidate, or refuse it: when it is exclusive and every wav of its pool still
   * sounds, or when the world is full of sounds at least as loud. A full world otherwise gives the
   * shot the quietest voice's slot. The started shot carries its own rate and level within
   * {@link RATE_JITTER} and {@link GAIN_JITTER_DB}. Returns what the engine plays; the caller spends
   * the lane's budget only on that.
   */
  startWorld(shot: OneShot, now: number): OneShot | null {
    const file = this.pick(shot.files, shot.exclusive !== undefined, now);
    if (file === null) return null;
    if (this.world.length >= WORLD_VOICE_CAP) {
      let quietest: WorldVoice | null = null;
      for (const voice of this.world) if (quietest === null || voice.gain < quietest.gain) quietest = voice;
      // An equal is not stolen: that would cut a sound short for nothing louder.
      if (quietest === null || shot.gain <= quietest.gain) return null;
      this.steal(quietest);
    }
    const pool = this.pool(shot.files);
    const instance = this.nextInstance++;
    const rate = 1 + this.jitter(RATE_JITTER);
    const gain = shot.gain * 10 ** (this.jitter(GAIN_JITTER_DB) / 20);
    const play = this.record(shot, pool, file, now, rate);
    pool.playing++;
    pool.lastStart = now;
    this.world.push({ instance, play, gain, pool });
    return { ...shot, files: [file], gain, rate, instance };
  }

  /**
   * A shot outside the world lanes (an order's answer, a GUI cue): never capped or stolen, but held by
   * its key cooldown and its exclusivity like any other. An answer waits while any line of its pool
   * still sounds, unless every such line yields to it, which it then cuts short. Returns what the engine
   * plays, or null.
   */
  startFree(shot: OneShot, now: number): OneShot | null {
    if (shot.files.length === 0 || this.keyCooling(shot.key, now)) return null;
    if (shot.exclusive === 'group' && !this.supersede(shot, now)) return null;
    const file = this.pick(shot.files, shot.exclusive !== undefined, now);
    if (file === null) return null;
    const play = this.record(shot, this.pool(shot.files), file, now);
    if (shot.yieldsToAnswer !== true) return { ...shot, files: [file] };
    const instance = this.nextInstance++;
    this.yielding.set(play, instance);
    return { ...shot, files: [file], instance };
  }

  /**
   * Whether a group-exclusive shot may start over its pool ({@link OneShot.poolFiles}): no wav of it
   * sounds, or only lines that yield to it, which are stopped. A yielding shot never cuts another.
   * Without `stop` a cut line plays on and keeps its wav from the pick.
   */
  private supersede(shot: OneShot, now: number): boolean {
    const cut: Play[] = [];
    for (const file of shot.poolFiles ?? shot.files) {
      const play = this.lastPlay.get(file);
      if (play === undefined || this.endOf(play) <= now) continue;
      if (shot.yieldsToAnswer === true || !this.yielding.has(play)) return false;
      cut.push(play);
    }
    const stop = this.playback.stop;
    if (stop === undefined) return true;
    for (const play of cut) {
      const instance = this.yielding.get(play);
      this.yielding.delete(play);
      this.lastPlay.delete(play.file);
      if (instance !== undefined) stop(instance, 'yield');
    }
    return true;
  }

  /** A jingle the arbiter rang, on one wav of its pool picked without repeats; its lane already
   *  decided that it rings. */
  ring(shot: OneShot, now: number): OneShot {
    const file = this.pick(shot.files, false, now);
    if (file === null) return shot;
    this.record(shot, this.pool(shot.files), file, now);
    return { ...shot, files: [file] };
  }

  /** A shot's start: its wav sounds from its delay on, and its key cools from now. */
  private record(shot: OneShot, pool: PoolState, file: string, now: number, rate = 1): Play {
    const play: Play = { file, startedAt: now + (shot.delayS ?? 0), rate };
    this.lastPlay.set(file, play);
    this.keyReadyAt.set(shot.key, now + (shot.cooldownS ?? KEY_COOLDOWN_S));
    pool.recent.push(file);
    if (pool.recent.length > noRepeatDepth(shot.files.length)) pool.recent.shift();
    return play;
  }

  private endOf(play: Play): number {
    return play.startedAt + (this.playback.clipLengthS?.(play.file) ?? DEFAULT_CLIP_LENGTH_S) / play.rate;
  }

  /** A uniform draw in [-span, span) from the injected source. */
  private jitter(span: number): number {
    return (this.random() * 2 - 1) * span;
  }

  private steal(victim: WorldVoice): void {
    const at = this.world.indexOf(victim);
    if (at >= 0) this.world.splice(at, 1);
    victim.pool.playing--;
    // Without `stop` the stolen wav plays on, so it still holds its wav.
    if (this.playback.stop === undefined) return;
    if (this.lastPlay.get(victim.play.file) === victim.play) this.lastPlay.delete(victim.play.file);
    this.playback.stop(victim.instance, 'steal');
  }

  /**
   * A wav of a non-empty pool it has not played lately, drawn by the injected source. An exclusive
   * shot draws only among the wavs not sounding, and gets null when every one still sounds.
   */
  private pick(files: readonly string[], exclusive: boolean, now: number): string | null {
    const recent = this.pool(files).recent;
    const free = exclusive ? files.filter((file) => !this.sounding(file, now)) : files;
    const fresh = free.filter((file) => !recent.includes(file));
    const choices = fresh.length > 0 ? fresh : free;
    if (choices.length <= 1) return choices[0] ?? null;
    return choices[Math.floor(this.random() * choices.length)] ?? null;
  }

  private pool(files: readonly string[]): PoolState {
    let pool = this.pools.get(files);
    if (pool === undefined) {
      pool = { recent: [], playing: 0, lastStart: Number.NEGATIVE_INFINITY, candidate: null };
      this.pools.set(files, pool);
    }
    return pool;
  }

  /** Whether `key` started within its cooldown ({@link OneShot.cooldownS}) of `now`. */
  keyCooling(key: string, now: number): boolean {
    const readyAt = this.keyReadyAt.get(key);
    return readyAt !== undefined && now < readyAt;
  }

  private sounding(file: string, now: number): boolean {
    const play = this.lastPlay.get(file);
    return play !== undefined && this.endOf(play) > now;
  }

  private anySounding(files: readonly string[], now: number): boolean {
    return files.some((file) => this.sounding(file, now));
  }
}
