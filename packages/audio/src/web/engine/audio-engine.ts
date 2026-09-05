import type { MusicTrack } from '../../data/music/index.js';
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
/** Default game-sounds volume - the owned install's `opt_game.ini` `fx_volume 100`, as the 0..1
 *  slider position ({@link sfxBusGain} maps it onto gain). */
export const DEFAULT_SFX_VOLUME = 1;
/** Default music volume - the owned install's `opt_game.ini` `dm_volume 70`, which is that install's
 *  saved player preference rather than a value the game shipped with. */
export const DEFAULT_MUSIC_VOLUME = 0.7;
/** A user volume change ramps over this many seconds - long enough to avoid a zipper click. */
export const VOLUME_RAMP_S = 0.05;

/** The original music master's fixed offset: `dm_volume` percent becomes
 *  `-500 + 2000*log10(percent/100)` hundredths of dB, i.e. a linear-amplitude curve offset by
 *  -5 dB (byte evidence: the master-volume conversion in `the original`). */
const MUSIC_MASTER_OFFSET_DB = -5;
/** Clip headroom the music stage bakes into the rendered files (its `MASTER_GAIN`, -3 dB). The
 *  original chain has no counterpart for it, so the bus adds it back; the two must move together. */
const RENDERED_MUSIC_HEADROOM_DB = 3;

/** Music-slider position (0..1) to music bus gain: the original's linear-amplitude curve, with the
 *  file headroom undone. */
export function musicBusGain(volume: number): number {
  return clampVolume(volume) * 10 ** ((MUSIC_MASTER_OFFSET_DB + RENDERED_MUSIC_HEADROOM_DB) / 20);
}

/**
 * SFX-slider position (0..1) to game-sounds bus gain. The original maps `fx_volume` percent
 * linearly in dB over a 20 dB range: `(percent - 100) * 20` hundredths of dB (byte evidence: the
 * fx-volume conversion in `the original`). Deviation: 0 mutes fully, where the original floors at
 * -20 dB.
 */
export function sfxBusGain(volume: number): number {
  const v = clampVolume(volume);
  return v <= 0 ? 0 : 10 ** (v - 1);
}

/** Jingle duck depth on the music bus: -2000 hundredths of dB (byte evidence: the jingle path in
 *  `the original` fades the music audiopath by that much while a jingle rings). */
export const MUSIC_DUCK_GAIN = 10 ** (-20 / 20);
/** The duck's fade time each way: 0x12C ms in the same jingle path. */
export const MUSIC_DUCK_RAMP_S = 0.3;
/** An identical one-shot key retriggers no sooner than this many seconds apart (anti machine-gun). */
export const ONE_SHOT_COOLDOWN_S = 0.12;
/** Prune the one-shot cooldown map when it grows past this many entries (keys are per-entity, never reused). */
export const COOLDOWN_PRUNE_SIZE = 512;
/** Shared empty rotation, so re-asserting a single track every frame allocates nothing. */
const EMPTY_ROTATION: readonly MusicTrack[] = [];

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
  private musicDuck: GainNode | null = null;
  /** Audio-clock time the running jingle duck may lift at; null while the music is not ducked. */
  private duckedUntil: number | null = null;
  private samples: SampleCache | null = null;
  private mixer: AmbientMixer | null = null;
  private music: MusicPlayer | null = null;
  /** Current bus volumes - kept here so a setter before the context exists still lands. */
  private sfxVolume: number;
  private musicVolume: number;
  /** The track that should be playing - re-asserted when a resume/unmute brings playback back. */
  private desiredMusic: MusicTrack | null = null;
  /** The rotation that should be playing instead; non-empty wins over {@link desiredMusic}. */
  private desiredRotation: readonly MusicTrack[] = EMPTY_ROTATION;
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
    // Music requested while suspended starts on the gesture that unlocked audio.
    this.assertMusic();
  }

  /** Mute/unmute without tearing down state (running ambient loops and music fade out on mute). */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.mixer?.stopAll();
      this.music?.stop();
    } else {
      this.assertMusic();
    }
  }

  /**
   * Release the audio context and go permanently silent. A view that hands over to another one closes
   * its engine, so a page never accumulates contexts past the browser's cap.
   */
  close(): void {
    const ctx = this.ctx;
    if (ctx === null) return;
    this.mixer?.stopAll();
    this.music?.stop();
    void ctx.close().catch(() => undefined); // a context already closed elsewhere rejects
  }

  /** Which music track should be playing (null = none); takes effect once playback is live. */
  setMusic(track: MusicTrack | null): void {
    this.desiredMusic = track;
    this.desiredRotation = EMPTY_ROTATION;
    if (this.canPlay()) this.music?.set(track);
  }

  /** Play `tracks` one at a time in the given order, moving on when each finishes; empty = no music. */
  setMusicRotation(tracks: readonly MusicTrack[]): void {
    this.desiredMusic = null;
    this.desiredRotation = tracks;
    if (this.canPlay()) this.music?.setRotation(tracks);
  }

  /** Set the game-sounds slider (0..1); the bus ramps to {@link sfxBusGain} to avoid a zipper click. */
  setSfxVolume(volume: number): void {
    this.sfxVolume = clampVolume(volume);
    if (this.sfxBus !== null && this.ctx !== null) rampTo(this.ctx, this.sfxBus, sfxBusGain(this.sfxVolume));
  }

  /** Set the music slider (0..1); the bus ramps to {@link musicBusGain} to avoid a zipper click. */
  setMusicVolume(volume: number): void {
    this.musicVolume = clampVolume(volume);
    if (this.musicBus !== null && this.ctx !== null) {
      rampTo(this.ctx, this.musicBus, musicBusGain(this.musicVolume));
    }
  }

  /** Apply one decided frame: fire its one-shots, reconcile its ambient loops, settle the duck. */
  apply(frame: AudioFrame): void {
    const ctx = this.ctx;
    if (!this.canPlay() || ctx === null || this.samples === null || this.mixer === null) return;
    for (const shot of frame.oneShots) this.playOneShot(ctx, this.samples, shot);
    this.mixer.reconcile(frame.ambient);
    this.updateMusicDuck(ctx);
  }

  /** Duck the music under a ringing jingle, extending the hold a running duck already has. */
  private duckMusic(ctx: AudioContext, holdMs: number): void {
    if (this.musicDuck === null) return;
    if (this.duckedUntil === null) rampDuck(ctx, this.musicDuck, MUSIC_DUCK_GAIN);
    this.duckedUntil = Math.max(this.duckedUntil ?? 0, ctx.currentTime + holdMs / 1000);
  }

  /** Restore a run-out duck; checked every applied frame, like the original's per-frame update. */
  private updateMusicDuck(ctx: AudioContext): void {
    if (this.duckedUntil === null || this.musicDuck === null) return;
    if (ctx.currentTime < this.duckedUntil) return;
    rampDuck(ctx, this.musicDuck, 1);
    this.duckedUntil = null;
  }

  private assertMusic(): void {
    if (!this.canPlay()) return;
    if (this.desiredRotation.length > 0) this.music?.setRotation(this.desiredRotation);
    else this.music?.set(this.desiredMusic);
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
    sfxBus.gain.value = sfxBusGain(this.sfxVolume);
    sfxBus.connect(master);
    const musicBus = ctx.createGain();
    musicBus.gain.value = musicBusGain(this.musicVolume);
    // The duck sits behind the volume bus so a slider move and a running duck compose.
    const musicDuck = ctx.createGain();
    musicDuck.gain.value = 1;
    musicBus.connect(musicDuck);
    musicDuck.connect(master);
    this.ctx = ctx;
    this.master = master;
    this.sfxBus = sfxBus;
    this.musicBus = musicBus;
    this.musicDuck = musicDuck;
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
      // The duck follows the shots that actually ring: a missing or undecodable wav dims nothing.
      if (shot.duckMusicMs !== undefined) this.duckMusic(ctx, shot.duckMusicMs);
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

/** The duck's fade, exponential because the original ramps the audiopath volume linearly in dB. */
function rampDuck(ctx: AudioContext, bus: GainNode, target: number): void {
  const now = ctx.currentTime;
  // An exponential ramp needs a nonzero anchor; the duck only ever moves between 1 and its depth.
  const from = Math.max(bus.gain.value, MUSIC_DUCK_GAIN);
  bus.gain.cancelScheduledValues(now);
  bus.gain.setValueAtTime(from, now);
  bus.gain.exponentialRampToValueAtTime(target, now + MUSIC_DUCK_RAMP_S);
}
