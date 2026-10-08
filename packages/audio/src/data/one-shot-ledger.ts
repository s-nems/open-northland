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
/** An identical key restarts no sooner than this. Approximation, the engine's own one-shot cooldown. */
export const KEY_COOLDOWN_S = 0.12;
/** The length a clip is taken to run before the engine has decoded it. Approximation: the median
 *  one-shot of the decoded bank runs 0.8-1.1 s. */
export const DEFAULT_CLIP_LENGTH_S = 1;
/** Wavs of a pool left free to pick from: the rest are the last ones played and wait their turn.
 *  Remembering all but one would freeze the order into a fixed loop after one round. */
export const NO_REPEAT_FREE_CHOICES = 2;
/** The key-cooldown and sounding maps sweep expired entries once they grow this large. */
export const LEDGER_PRUNE_SIZE = 512;

/**
 * What the arbiter asks of the playback engine, both optional so it runs headless. Without
 * `clipLengthS` every clip is taken to run {@link DEFAULT_CLIP_LENGTH_S}; without `stop` a stolen
 * one-shot keeps sounding to its end and only its slot is reused.
 */
export interface OneShotPlayback {
  /** The decoded length of `file` in seconds, or undefined while the engine has not decoded it. */
  readonly clipLengthS?: (file: string) => number | undefined;
  /** Fade out the world one-shot started as `instance` ({@link OneShot.instance}): its slot was stolen. */
  readonly stop?: (instance: number) => void;
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

/** One start of a wav. */
interface Play {
  readonly file: string;
  readonly startedAt: number;
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

function pruneExpired(map: Map<string, number>, now: number, maxAge: number): void {
  if (map.size < LEDGER_PRUNE_SIZE) return;
  for (const [key, when] of map) if (now - when >= maxAge) map.delete(key);
}

export class OneShotLedger {
  /** Pools by their file list: shots of one sound group share the index's array. */
  private readonly pools = new WeakMap<readonly string[], PoolState>();
  /** wav → its latest play. */
  private readonly lastPlay = new Map<string, Play>();
  /** key → audio-clock second of its latest start. */
  private readonly lastStarted = new Map<string, number>();
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
    pruneExpired(this.lastStarted, now, KEY_COOLDOWN_S);
    if (this.lastPlay.size >= LEDGER_PRUNE_SIZE) {
      for (const [file, play] of this.lastPlay) if (this.endOf(play) <= now) this.lastPlay.delete(file);
    }
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
    if (shot.exclusive === 'group' && this.anySounding(shot.files, now)) return;
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
   * shot the quietest voice's slot. Returns what the engine plays; the caller spends the lane's budget
   * only on that.
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
    const play = this.record(shot, pool, file, now);
    pool.playing++;
    pool.lastStart = now;
    this.world.push({ instance, play, gain: shot.gain, pool });
    return { ...shot, files: [file], instance };
  }

  /**
   * A shot outside the world lanes (an order's answer, a script cue): never capped or stolen, but held
   * by its key cooldown and its exclusivity like any other. Returns what the engine plays, or null.
   */
  startFree(shot: OneShot, now: number): OneShot | null {
    if (shot.files.length === 0 || this.keyCooling(shot.key, now)) return null;
    if (shot.exclusive === 'group') {
      // An answer keeps its whole pool: the engine, which knows each line's decoded length, holds it
      // while any line still sounds. It costs no budget, so passing it on spends nothing in vain.
      this.lastStarted.set(shot.key, now);
      return shot;
    }
    const file = this.pick(shot.files, shot.exclusive !== undefined, now);
    if (file === null) return null;
    this.record(shot, this.pool(shot.files), file, now);
    return { ...shot, files: [file] };
  }

  private record(shot: OneShot, pool: PoolState, file: string, now: number): Play {
    const play: Play = { file, startedAt: now };
    this.lastPlay.set(file, play);
    this.lastStarted.set(shot.key, now);
    pool.recent.push(file);
    if (pool.recent.length > noRepeatDepth(shot.files.length)) pool.recent.shift();
    return play;
  }

  private endOf(play: Play): number {
    return play.startedAt + (this.playback.clipLengthS?.(play.file) ?? DEFAULT_CLIP_LENGTH_S);
  }

  private steal(victim: WorldVoice): void {
    const at = this.world.indexOf(victim);
    if (at >= 0) this.world.splice(at, 1);
    victim.pool.playing--;
    // Without `stop` the stolen wav plays on, so it still holds its wav.
    if (this.playback.stop === undefined) return;
    if (this.lastPlay.get(victim.play.file) === victim.play) this.lastPlay.delete(victim.play.file);
    this.playback.stop(victim.instance);
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

  private keyCooling(key: string, now: number): boolean {
    const last = this.lastStarted.get(key);
    return last !== undefined && now - last < KEY_COOLDOWN_S;
  }

  private sounding(file: string, now: number): boolean {
    const play = this.lastPlay.get(file);
    return play !== undefined && this.endOf(play) > now;
  }

  private anySounding(files: readonly string[], now: number): boolean {
    return files.some((file) => this.sounding(file, now));
  }
}
