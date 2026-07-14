import type { AudioFrame, OneShot } from '../../data/types.js';
import {
  type ContextFactory,
  type FetchBytes,
  httpFetchBytes,
  pickRandom,
  type RandomFn,
  webAudioContextFactory,
} from '../platform.js';
import { pruneExpired } from '../prune.js';
import { AmbientMixer } from './ambient-mixer.js';
import { SampleCache } from './sample-cache.js';

/**
 * The impure Web Audio playback sink — the only part of the package that owns an `AudioContext`. It
 * takes the pure {@link AudioFrame} the director decided and makes it audible: fires debounced
 * one-shots through a per-play gain+pan graph, and hands the ambient set to the
 * {@link AmbientMixer} to reconcile. Loading/decoding is the {@link SampleCache}'s. All timing rides
 * the audio clock (`ctx.currentTime`), never `Date.now`, so ramps stay sample-accurate.
 *
 * Browser autoplay policy: the context starts suspended and makes no sound until {@link resume} is
 * called from inside a user gesture — the app wires that to the first click/key. Before then, and on
 * any decode/fetch failure, playback is a graceful no-op (silence), never a throw.
 */

/** Options for {@link WebAudioEngine}. Platform seams default to the real browser behaviour. */
export interface AudioEngineOptions {
  /** URL prefix the wav files are served under (a file path is appended). Default {@link DEFAULT_SOUNDS_BASE_URL}. */
  readonly baseUrl?: string;
  /** Overall output gain (0..1). Default {@link DEFAULT_MASTER_GAIN}. */
  readonly masterGain?: number;
  /** Creates the `AudioContext` — override in tests with a fake. Default the real Web Audio context. */
  readonly createContext?: ContextFactory;
  /** Loads a wav's bytes by URL — override in tests with a stub. Default HTTP `fetch`. */
  readonly fetchBytes?: FetchBytes;
  /** The [0,1) random source for wav picks — override in tests for determinism. Default `Math.random`. */
  readonly random?: RandomFn;
}

/** Default URL prefix the decoded wavs are served under (the dev server's sounds route). */
export const DEFAULT_SOUNDS_BASE_URL = '/sounds/';
/** Default overall output gain. */
export const DEFAULT_MASTER_GAIN = 0.8;
/** An identical one-shot key retriggers no sooner than this many seconds apart (anti machine-gun). */
export const ONE_SHOT_COOLDOWN_S = 0.12;
/** Prune the one-shot cooldown map when it grows past this many entries (keys are per-entity, never reused). */
export const COOLDOWN_PRUNE_SIZE = 512;

export class WebAudioEngine {
  private readonly baseUrl: string;
  private readonly masterGainValue: number;
  private readonly createContext: ContextFactory;
  private readonly fetchBytes: FetchBytes;
  private readonly random: RandomFn;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private samples: SampleCache | null = null;
  private mixer: AmbientMixer | null = null;
  private enabled = true;
  /** one-shot key → last play time (audio clock seconds) for cooldown debounce. */
  private readonly lastPlayed = new Map<string, number>();

  constructor(options: AudioEngineOptions = {}) {
    this.baseUrl = options.baseUrl ?? DEFAULT_SOUNDS_BASE_URL;
    this.masterGainValue = options.masterGain ?? DEFAULT_MASTER_GAIN;
    this.createContext = options.createContext ?? webAudioContextFactory;
    this.fetchBytes = options.fetchBytes ?? httpFetchBytes;
    this.random = options.random ?? Math.random;
  }

  /** Whether the context has been started (a user gesture resumed it). */
  get started(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  /** Live and audible (started and not muted). While false, applied frames are dropped unheard —
   *  callers can skip building them at all. */
  get audible(): boolean {
    return this.canPlay();
  }

  /**
   * Start (or resume) the audio context — must be called from within a user gesture the first time,
   * or the browser keeps it suspended. Creates the context lazily on first call. Safe to call repeatedly.
   */
  async resume(): Promise<void> {
    const ctx = this.ensureContext();
    if (ctx === null) return;
    if (ctx.state !== 'running') {
      try {
        await ctx.resume();
      } catch {
        // A browser that refuses to resume outside a gesture just stays silent — not an error.
      }
    }
  }

  /** Mute/unmute without tearing down state (running ambient loops fade out on mute). */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.mixer?.stopAll();
  }

  /** Apply one decided frame: fire its one-shots and reconcile its ambient loops. */
  apply(frame: AudioFrame): void {
    const ctx = this.ctx;
    if (!this.canPlay() || ctx === null || this.samples === null || this.mixer === null) return;
    for (const shot of frame.oneShots) this.playOneShot(ctx, this.samples, shot);
    this.mixer.reconcile(frame.ambient);
  }

  /** Live and audible: not muted, context created + resumed. Re-checked after every async load. */
  private canPlay(): boolean {
    return this.enabled && this.ctx !== null && this.ctx.state === 'running' && this.master !== null;
  }

  private ensureContext(): AudioContext | null {
    if (this.ctx !== null) return this.ctx;
    const ctx = this.createContext();
    if (ctx === null) return null; // no Web Audio (headless/unsupported) → silent
    const master = ctx.createGain();
    master.gain.value = this.masterGainValue;
    master.connect(ctx.destination);
    this.ctx = ctx;
    this.master = master;
    this.samples = new SampleCache(this.baseUrl, this.fetchBytes, (bytes) => ctx.decodeAudioData(bytes));
    this.mixer = new AmbientMixer(ctx, master, this.samples, () => this.canPlay());
    return ctx;
  }

  private playOneShot(ctx: AudioContext, samples: SampleCache, shot: OneShot): void {
    const now = ctx.currentTime;
    const last = this.lastPlayed.get(shot.key);
    if (last !== undefined && now - last < ONE_SHOT_COOLDOWN_S) return;
    pruneExpired(this.lastPlayed, COOLDOWN_PRUNE_SIZE, now, ONE_SHOT_COOLDOWN_S);
    this.lastPlayed.set(shot.key, now);
    if (shot.files.length === 0) return;
    // Randomness lives here (impure), not in the pure director.
    const file = pickRandom(shot.files, this.random);
    void samples.get(file).then((buffer) => {
      if (buffer === null || !this.canPlay() || this.master === null) return;
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      const gain = ctx.createGain();
      gain.gain.value = shot.gain;
      // StereoPannerNode is absent on some old `webkitAudioContext` builds; degrade to unpanned rather
      // than throwing inside this un-awaited promise (which would silently drop all positional SFX).
      const head = this.pannerFor(ctx, shot.pan) ?? source;
      if (head !== source) source.connect(head);
      head.connect(gain).connect(this.master);
      source.start();
    });
  }

  /** A `StereoPannerNode` set to `pan`, or null when the context can't make one (old webkit). */
  private pannerFor(ctx: AudioContext, pan: number): StereoPannerNode | null {
    if (typeof ctx.createStereoPanner !== 'function') return null;
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    return panner;
  }
}
