import type { MusicTrack } from '../../data/music.js';
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
import { MusicPlayer } from './music-player.js';
import { SampleCache } from './sample-cache.js';

/**
 * The impure Web Audio playback sink - the only part of the package that owns an `AudioContext`. It
 * takes the pure {@link AudioFrame} the director decided and makes it audible: fires debounced
 * one-shots through a per-play gain+pan graph, and hands the ambient set to the {@link AmbientMixer}
 * to reconcile ({@link SampleCache} loads/decodes). All timing rides the audio clock
 * (`ctx.currentTime`), never `Date.now`, so ramps stay sample-accurate.
 *
 * The context starts suspended ({@link resume} starts it); before then, and on any decode/fetch
 * failure, playback is a graceful no-op (silence), never a throw.
 */

/** Options for {@link WebAudioEngine}. Platform seams default to the real browser behaviour. */
export interface AudioEngineOptions {
  /** URL prefix the wav files are served under (a file path is appended). Default {@link DEFAULT_SOUNDS_BASE_URL}. */
  readonly baseUrl?: string;
  /** URL prefix the rendered music files are served under. Default {@link DEFAULT_MUSIC_BASE_URL}. */
  readonly musicBaseUrl?: string;
  /** Overall output gain (0..1). Default {@link DEFAULT_MASTER_GAIN}. */
  readonly masterGain?: number;
  /** Initial game-sounds bus volume (0..1). Default {@link DEFAULT_SFX_VOLUME}. */
  readonly sfxVolume?: number;
  /** Initial music bus volume (0..1). Default {@link DEFAULT_MUSIC_VOLUME}. */
  readonly musicVolume?: number;
  /** Creates the `AudioContext` - override in tests with a fake. Default the real Web Audio context. */
  readonly createContext?: ContextFactory;
  /** Loads a wav's bytes by URL - override in tests with a stub. Default HTTP `fetch`. */
  readonly fetchBytes?: FetchBytes;
  /** The [0,1) random source for wav picks - override in tests for determinism. Default `Math.random`. */
  readonly random?: RandomFn;
}

/** Default URL prefix the decoded wavs are served under (the dev server's sounds route). */
export const DEFAULT_SOUNDS_BASE_URL = '/sounds/';
/** Default URL prefix the rendered music tracks are served under (the dev server's music route). */
export const DEFAULT_MUSIC_BASE_URL = '/music/';
/** Default overall output gain. */
export const DEFAULT_MASTER_GAIN = 0.8;
/** Default game-sounds volume - the owned install's `opt_game.ini` `fx_volume 100`. The linear
 *  0..1 map of the original 0-100 scale onto Web Audio gain is an approximation. */
export const DEFAULT_SFX_VOLUME = 1;
/** Default music volume - the owned install's `opt_game.ini` `dm_volume 70`. */
export const DEFAULT_MUSIC_VOLUME = 0.7;
/** A user volume change ramps over this many seconds - long enough to avoid a zipper click. */
export const VOLUME_RAMP_S = 0.05;
/** An identical one-shot key retriggers no sooner than this many seconds apart (anti machine-gun). */
export const ONE_SHOT_COOLDOWN_S = 0.12;
/** Prune the one-shot cooldown map when it grows past this many entries (keys are per-entity, never reused). */
export const COOLDOWN_PRUNE_SIZE = 512;

export class WebAudioEngine {
  private readonly baseUrl: string;
  private readonly musicBaseUrl: string;
  private readonly masterGainValue: number;
  private readonly createContext: ContextFactory;
  private readonly fetchBytes: FetchBytes;
  private readonly random: RandomFn;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private samples: SampleCache | null = null;
  private mixer: AmbientMixer | null = null;
  private music: MusicPlayer | null = null;
  /** Current bus volumes - kept here so a setter before the context exists still lands. */
  private sfxVolume: number;
  private musicVolume: number;
  /** The track that should be playing - re-asserted when a resume/unmute brings playback back. */
  private desiredMusic: MusicTrack | null = null;
  private enabled = true;
  /** one-shot key → last play time (audio clock seconds) for cooldown debounce. */
  private readonly lastPlayed = new Map<string, number>();

  constructor(options: AudioEngineOptions = {}) {
    this.baseUrl = options.baseUrl ?? DEFAULT_SOUNDS_BASE_URL;
    this.musicBaseUrl = options.musicBaseUrl ?? DEFAULT_MUSIC_BASE_URL;
    this.masterGainValue = options.masterGain ?? DEFAULT_MASTER_GAIN;
    this.sfxVolume = clampVolume(options.sfxVolume ?? DEFAULT_SFX_VOLUME);
    this.musicVolume = clampVolume(options.musicVolume ?? DEFAULT_MUSIC_VOLUME);
    this.createContext = options.createContext ?? webAudioContextFactory;
    this.fetchBytes = options.fetchBytes ?? httpFetchBytes;
    this.random = options.random ?? Math.random;
  }

  /** Whether the context has been started (a user gesture resumed it). */
  get started(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  /** Live and audible (started and not muted). While false, applied frames are dropped unheard -
   *  callers can skip building them at all. */
  get audible(): boolean {
    return this.canPlay();
  }

  /**
   * Start (or resume) the audio context - must be called from within a user gesture the first time,
   * or the browser keeps it suspended. Creates the context lazily on first call. Safe to call repeatedly.
   */
  async resume(): Promise<void> {
    const ctx = this.ensureContext();
    if (ctx === null) return;
    if (ctx.state !== 'running') {
      try {
        await ctx.resume();
      } catch {
        // A browser that refuses to resume outside a gesture just stays silent - not an error.
      }
    }
    // A track requested while suspended starts on the gesture that unlocked audio.
    if (this.canPlay()) this.music?.set(this.desiredMusic);
  }

  /** Mute/unmute without tearing down state (running ambient loops and music fade out on mute). */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.mixer?.stopAll();
      this.music?.stop();
    } else if (this.canPlay()) {
      this.music?.set(this.desiredMusic);
    }
  }

  /** Which music track should be playing (null = none); takes effect once playback is live. */
  setMusic(track: MusicTrack | null): void {
    this.desiredMusic = track;
    if (this.canPlay()) this.music?.set(track);
  }

  /** Set the game-sounds bus volume (0..1), ramped to avoid a zipper click. */
  setSfxVolume(volume: number): void {
    this.sfxVolume = clampVolume(volume);
    if (this.sfxBus !== null && this.ctx !== null) rampTo(this.ctx, this.sfxBus, this.sfxVolume);
  }

  /** Set the music bus volume (0..1), ramped to avoid a zipper click. */
  setMusicVolume(volume: number): void {
    this.musicVolume = clampVolume(volume);
    if (this.musicBus !== null && this.ctx !== null) rampTo(this.ctx, this.musicBus, this.musicVolume);
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
    const sfxBus = ctx.createGain();
    sfxBus.gain.value = this.sfxVolume;
    sfxBus.connect(master);
    const musicBus = ctx.createGain();
    musicBus.gain.value = this.musicVolume;
    musicBus.connect(master);
    this.ctx = ctx;
    this.master = master;
    this.sfxBus = sfxBus;
    this.musicBus = musicBus;
    this.samples = new SampleCache(this.baseUrl, this.fetchBytes, (bytes) => ctx.decodeAudioData(bytes));
    this.mixer = new AmbientMixer(ctx, sfxBus, this.samples, () => this.canPlay());
    this.music = new MusicPlayer(ctx, musicBus, this.musicBaseUrl, this.fetchBytes, () => this.canPlay());
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
      if (buffer === null || !this.canPlay() || this.sfxBus === null) return;
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      const gain = ctx.createGain();
      gain.gain.value = shot.gain;
      // StereoPannerNode is absent on some old `webkitAudioContext` builds; degrade to unpanned rather
      // than throwing inside this un-awaited promise (which would silently drop all positional SFX).
      const head = this.pannerFor(ctx, shot.pan) ?? source;
      if (head !== source) source.connect(head);
      head.connect(gain).connect(this.sfxBus);
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

function clampVolume(volume: number): number {
  return Math.min(1, Math.max(0, volume));
}

function rampTo(ctx: AudioContext, bus: GainNode, target: number): void {
  const now = ctx.currentTime;
  bus.gain.cancelScheduledValues(now);
  bus.gain.setValueAtTime(bus.gain.value, now);
  bus.gain.linearRampToValueAtTime(target, now + VOLUME_RAMP_S);
}
