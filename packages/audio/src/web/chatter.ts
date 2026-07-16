import { groupFiles, type SoundIndex } from '../data/bank.js';
import { VIKING_VOICE_POOLS, type VoiceClass, vikingVoiceClass } from '../data/bindings.js';
import type { OnScreenSettler } from '../data/director/settlers.js';
import type { OneShot } from '../data/types.js';
import { pickRandom, type RandomFn } from './platform.js';
import { pruneExpired } from './prune.js';

/**
 * The stochastic settler voice-chatter emitter: at ~{@link VOICE_RATE_PER_SEC} clips/second across the
 * visible crowd, pick a random on-screen settler (respecting its {@link VOICE_COOLDOWN_MS}) and draw a
 * clip group from the pool matching that settler's sex/age. The impure "who speaks now" half; the pure
 * "who could speak" candidate list is {@link import('../data/director/settlers.js').onScreenSettlers}.
 */

/** Base gain of a settler voice (below SFX so chatter sits under the action, not over it). */
export const VOICE_GAIN = 0.7;
/** Target number of voice clips per second across the whole on-screen crowd (scaled by, not per, settler). */
export const VOICE_RATE_PER_SEC = 1.6;
/** A given settler won't speak again for this long (ms) — so voices feel like people, not a loop. */
export const VOICE_COOLDOWN_MS = 4000;
/**
 * Clamp on the per-frame `dtMs` the chatter emitter integrates. A backgrounded tab pauses RAF, so the
 * first frame after refocus carries a huge `elapsed` — without this the voice budget would jump by
 * dozens and fire a cluster at once. A quarter second is about three sim ticks at 12 Hz.
 */
export const MAX_CHATTER_DT_MS = 250;
/** Prune the per-settler speak-time map past this size (entities die/spawn; ids are never reused). */
export const VOICE_MAP_PRUNE_SIZE = 1024;

/** {@link ChatterEmitter} construction options. */
export interface ChatterOptions {
  /** Voice pools per sex/age the settler-chatter layer draws from; default {@link VIKING_VOICE_POOLS}. */
  readonly voicePools?: Readonly<Record<VoiceClass, readonly string[]>>;
  /** Classify a settler (`jobType` + `young`) → its voice class; default {@link vikingVoiceClass}. */
  readonly voiceClassOf?: (jobType: number | null, young: boolean) => VoiceClass;
  /** The [0,1) random source for settler/pool picks — override in tests for determinism. Default `Math.random`. */
  readonly random?: RandomFn;
}

export class ChatterEmitter {
  private readonly voicePools: Readonly<Record<VoiceClass, readonly string[]>>;
  private readonly voiceClassOf: (jobType: number | null, young: boolean) => VoiceClass;
  private readonly random: RandomFn;
  /** Fractional voice-clip budget carried between frames (a Poisson-ish emitter over `dtMs`). */
  private budget = 0;
  /** Monotonic emitter clock (ms, summed from `dtMs`) for the per-settler voice cooldown. */
  private clockMs = 0;
  /** entity id → the clock time it last spoke, so one settler doesn't chatter continuously. */
  private readonly lastSpokeAt = new Map<number, number>();

  constructor(
    private readonly index: SoundIndex,
    options: ChatterOptions = {},
  ) {
    this.voicePools = options.voicePools ?? VIKING_VOICE_POOLS;
    this.voiceClassOf = options.voiceClassOf ?? vikingVoiceClass;
    this.random = options.random ?? Math.random;
  }

  /**
   * Advance the emitter by `dtMs` and return the voice one-shots to fire this frame. `settlers` is a
   * thunk invoked only when the budget crosses a whole clip (~{@link VOICE_RATE_PER_SEC} Hz), so the
   * O(entities) on-screen scan runs at the voice rate, never per frame. An empty screen zeroes the
   * budget (a named approximation).
   */
  update(dtMs: number, settlers: () => readonly OnScreenSettler[]): OneShot[] {
    const dt = Math.min(dtMs, MAX_CHATTER_DT_MS);
    if (dt <= 0) return [];
    this.clockMs += dt;
    this.budget += (dt / 1000) * VOICE_RATE_PER_SEC;
    if (this.budget < 1) return []; // no clip due yet — skip the settler scan entirely this frame
    const crowd = settlers();
    if (crowd.length === 0) {
      this.budget = 0; // an empty screen banks nothing — no burst when settlers scroll back in
      return [];
    }
    pruneExpired(this.lastSpokeAt, VOICE_MAP_PRUNE_SIZE, this.clockMs, VOICE_COOLDOWN_MS);
    const shots: OneShot[] = [];
    while (this.budget >= 1) {
      this.budget -= 1;
      const settler = pickRandom(crowd, this.random);
      const last = this.lastSpokeAt.get(settler.entity);
      if (last !== undefined && this.clockMs - last < VOICE_COOLDOWN_MS) continue;
      const pool = this.voicePools[this.voiceClassOf(settler.jobType, settler.young)];
      if (pool.length === 0) continue;
      const group = pickRandom(pool, this.random);
      const files = groupFiles(this.index, group);
      if (files === undefined) continue;
      this.lastSpokeAt.set(settler.entity, this.clockMs);
      shots.push({
        files,
        gain: settler.gain * VOICE_GAIN,
        pan: settler.pan,
        key: `voice:${settler.entity}`,
      });
    }
    return shots;
  }
}
