import {
  clampVolume,
  DEFAULT_VOLUMES,
  type MixerVolumes,
  oneShotBus,
  SOUND_BUSES,
  type SoundBus,
  VOLUME_CHANNELS,
  type VolumeChannel,
  volumeGain,
} from '../../data/mixer.js';
import type { MusicSequence, MusicTransition } from '../../data/music/index.js';
import {
  muffleCutoffHz,
  PERSPECTIVE_CURVES,
  type PerspectiveLayer,
  perspectiveGain,
  SHOT_LAYERS,
  type ShotLayer,
  shotLayer,
  zoomDistance,
} from '../../data/perspective.js';
import type { AudioFrame, OneShot } from '../../data/types.js';
import type { WeatherSoundInput } from '../../data/weather/mix.js';
import {
  type ContextFactory,
  type FetchBytes,
  httpFetchBytes,
  performanceNow,
  type WallClock,
  webAudioContextFactory,
} from '../platform.js';
import { AmbientMixer } from './ambient-mixer.js';
import { BusDuck } from './bus-duck.js';
import { MusicPlayer } from './music-player.js';
import { CLICK_FREE_RAMP_S, rampParam } from './ramps.js';
import { type PreloadSample, SampleCache, type SamplePreloadReport } from './sample-cache.js';
import { WeatherSoundscape } from './weather-soundscape.js';

/**
 * The impure Web Audio playback sink - the only part of the package that owns an `AudioContext`. It
 * takes the pure {@link AudioFrame} the director decided and makes it audible: plays the one-shots
 * the arbiter let through, each on its one wav, through a per-play gain+pan graph, and hands the ambient set to the {@link AmbientMixer}
 * to reconcile ({@link SampleCache} loads/decodes). All timing rides the audio clock
 * (`ctx.currentTime`), never `Date.now`, so ramps stay sample-accurate.
 *
 * Graph: each sound feeds its {@link SoundBus} gain (one-shots by {@link oneShotBus}, beds and weather
 * on `ambient`, music through its jingle and voice ducks), every bus feeds the master gain, and the
 * master ends in a peak limiter before the destination. Zoom-following sounds enter their bus through one shared gain
 * per perspective layer ({@link import('../../data/perspective.js').PerspectiveLayer}), so a zoom moves
 * a handful of layer gains, never a playing sound.
 *
 * The context starts suspended ({@link resume} starts it); before then, and on any decode/fetch
 * failure, playback is a graceful no-op (silence), never a throw.
 */

/** A finished preload: what the cache holds, the wall time it took from the context's start, and the
 *  context rate every wav was resampled to. */
export interface SoundPreloadReport extends SamplePreloadReport {
  readonly elapsedMs: number;
  readonly sampleRate: number;
}

/** Options for {@link WebAudioEngine}. Platform seams default to the real browser behaviour. */
export interface AudioEngineOptions {
  /** URL prefix the wav files are served under (a file path is appended). Default {@link DEFAULT_SOUNDS_BASE_URL}. */
  readonly baseUrl?: string;
  /** URL prefix the rendered music files are served under. Default {@link DEFAULT_MUSIC_BASE_URL}. */
  readonly musicBaseUrl?: string;
  /** Initial slider positions. Default {@link DEFAULT_VOLUMES}. */
  readonly volumes?: MixerVolumes;
  /** Creates the `AudioContext` - override in tests with a fake. Default the real Web Audio context. */
  readonly createContext?: ContextFactory;
  /** Loads a wav's bytes by URL - override in tests with a stub. Default HTTP `fetch`. */
  readonly fetchBytes?: FetchBytes;
  /** Wall clock the preload timing and the stalled-clock check read - override in tests. Default
   *  `performance.now`. */
  readonly now?: WallClock;
}

/** URL prefix of the content tree's decoded wavs; every host serves the tree at the root. */
export const DEFAULT_SOUNDS_BASE_URL = '/sounds/';
/** URL prefix of the content tree's rendered music tracks. */
export const DEFAULT_MUSIC_BASE_URL = '/music/';
/** A slider move ramps its bus over this many seconds - long enough to avoid a zipper click. */
export const VOLUME_RAMP_S = 0.05;
/** A zoom step ramps the layer gains over this many seconds, so a wheel zoom glides the mix rather
 *  than stepping it. Approximation. */
export const PERSPECTIVE_RAMP_S = 0.1;
/** The zoom low-pass's resonance, in the dB Web Audio reads a low-pass Q in: -3 dB is a Butterworth
 *  response, flat with no bump at the corner. */
export const MUFFLE_Q_DB = -3;

/** The original music master's fixed -5 dB offset under the music slider. */
const MUSIC_MASTER_OFFSET_DB = -5;
/** Clip headroom the music stage bakes into the rendered files (its `MASTER_GAIN`, -3 dB). The
 *  original chain has no counterpart for it, so the bus adds it back; the two must move together. */
const RENDERED_MUSIC_HEADROOM_DB = 3;

/** Music-slider position to music bus gain: the shared slider curve with the original's offset and the
 *  file headroom undone. */
export function musicBusGain(position: number): number {
  return volumeGain(position) * 10 ** ((MUSIC_MASTER_OFFSET_DB + RENDERED_MUSIC_HEADROOM_DB) / 20);
}

// The master peak limiter, a `DynamicsCompressorNode` set to catch only the peaks of a dense mix. All
// approximations to tune by ear. The node adds the spec's automatic makeup gain (0.6 of the gain it
// takes off a full-scale input, about +1.7 dB here): the whole mix sits that much higher, and a 0 dBFS
// input leaves at about -1.1 dBFS.
/** Level the limiter starts to act at; below it the mix passes untouched. */
export const LIMITER_THRESHOLD_DB = -3;
/** Hard knee: no gradual onset below the threshold. */
export const LIMITER_KNEE_DB = 0;
/** The node's highest ratio, as close to a brick wall as it goes. */
export const LIMITER_RATIO = 20;
/** Fast enough to catch a transient, slow enough not to distort low frequencies. */
export const LIMITER_ATTACK_S = 0.003;
/** Recovery after a peak, short enough that the mix does not audibly pump. */
export const LIMITER_RELEASE_S = 0.15;
/** A closing engine fades the master out and closes the context this long after: the fade plus the
 *  output still buffered on its way to the device. Approximation. */
export const CLOSE_GRACE_S = 0.1;
/** The master's fade to silence when the page goes to the background, and back on return.
 *  Approximation. */
export const BACKGROUND_FADE_S = 0.3;
/** A running context whose clock has not moved for this long is stalled (a backgrounded Safari
 *  context can report `running` and stand still), so it counts as paused. Approximation. */
export const CLOCK_STALL_MS = 1000;
/** The master's channel count while the mix folds to mono; the destination spreads it to both ears. */
const MONO_CHANNELS = 1;

/** Jingle duck depth on the music bus: -2000 hundredths of dB, as the original fades the music
 *  audiopath while a jingle rings. */
export const MUSIC_DUCK_GAIN = 10 ** (-20 / 20);
/** The duck's fade time each way in the original: 300 ms. */
export const MUSIC_DUCK_RAMP_S = 0.3;

/** The voice duck's lift back to full music ({@link OneShot.duckMusicDb}): slower than its dip, so the
 *  score does not jump back between two quick answers, quick enough not to creep audibly. Approximation. */
export const VOICE_DUCK_RELEASE_S = 0.3;

/** The buses an alert ducks ({@link OneShot.duckWorldDb}): the world's action and its beds. */
export const ALERT_DUCKED_BUSES: readonly SoundBus[] = ['world', 'ambient'];

/** The buses that carry world one-shots, each split into the two {@link ShotLayer}s. */
type WorldBus = 'world' | 'voice';
const WORLD_BUSES: readonly WorldBus[] = ['world', 'voice'];

/** The per-layer gains in front of the buses: the world layers of `world` and `voice`, and the ambient
 *  bed layer the terrain beds and the weather share. A muffled layer's gain feeds its bus through one
 *  low-pass in `filters`. */
interface LayerGains {
  readonly shots: Readonly<Record<WorldBus, Readonly<Record<ShotLayer, GainNode>>>>;
  readonly bed: GainNode;
  readonly filters: readonly BiquadFilterNode[];
}

/** A started world one-shot's nodes, kept so a steal can fade and stop it. */
interface StoppableShot {
  readonly source: AudioBufferSourceNode;
  readonly gain: GainNode;
}

export class WebAudioEngine {
  private readonly baseUrl: string;
  private readonly musicBaseUrl: string;
  private readonly createContext: ContextFactory;
  private readonly fetchBytes: FetchBytes;
  private readonly now: WallClock;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buses: Readonly<Record<SoundBus, GainNode>> | null = null;
  private layers: LayerGains | null = null;
  /** The camera's zoom distance the layer gains are set for, kept here so a zoom before the context
   *  exists still lands. */
  private zoom = 0;
  private musicDuck: GainNode | null = null;
  /** Audio-clock time the running jingle duck may lift at; null while the music is not ducked. */
  private duckedUntil: number | null = null;
  /** The dips behind {@link ALERT_DUCKED_BUSES}. */
  private alertDucks: readonly BusDuck[] = [];
  /** The music's dip under a spoken line ({@link OneShot.duckMusicDb}), after the jingle duck. */
  private voiceDuck: BusDuck | null = null;
  private samples: SampleCache | null = null;
  /** Settles {@link samplesReady}: with the cache once the context exists, null if it never will. */
  private settleSamples: (samples: SampleCache | null) => void = () => undefined;
  /** The cache a preload waits for, which exists only once a gesture has created the context. */
  private readonly samplesReady = new Promise<SampleCache | null>((resolve) => {
    this.settleSamples = resolve;
  });
  /** The page is hidden or its window unfocused. */
  private pageInBackground = false;
  /** The player's "sound in background" choice; off silences a page in the background. */
  private playInBackground = true;
  /** The mix folds to one channel ({@link setMono}). */
  private mono = false;
  /** The audio clock at the last stall check, and the wall time it was first seen at. */
  private lastClock = { audio: -1, wallMs: 0 };
  private mixer: AmbientMixer | null = null;
  private music: MusicPlayer | null = null;
  private weather: WeatherSoundscape | null = null;
  /** The graphics "Weather" switch, kept here so a setter before the context exists still lands. */
  private weatherEnabled = true;
  /** Current slider positions - kept here so a setter before the context exists still lands. */
  private readonly volumes: Record<VolumeChannel, number>;
  /** The music that should be playing - re-asserted when a resume/unmute brings playback back. */
  private desiredMusic: MusicSequence | null = null;
  private enabled = true;
  /** Set by {@link close}; a closed engine never resumes its context again. */
  private closed = false;
  /** The world one-shots the arbiter may still stop, by {@link OneShot.instance}: null while the wav
   *  loads. An entry leaves when its source ends, its load fails, or a stop takes it. */
  private readonly stoppable = new Map<number, StoppableShot | null>();

  constructor(options: AudioEngineOptions = {}) {
    this.baseUrl = options.baseUrl ?? DEFAULT_SOUNDS_BASE_URL;
    this.musicBaseUrl = options.musicBaseUrl ?? DEFAULT_MUSIC_BASE_URL;
    this.volumes = clampedVolumes(options.volumes ?? DEFAULT_VOLUMES);
    this.createContext = options.createContext ?? webAudioContextFactory;
    this.fetchBytes = options.fetchBytes ?? httpFetchBytes;
    this.now = options.now ?? performanceNow;
  }

  /** Whether the context runs: a user gesture resumed it, and neither the platform nor a stalled clock
   *  has paused it since. */
  get started(): boolean {
    return this.ctx !== null && this.ctx.state === 'running' && !this.clockStalled(this.ctx);
  }

  /** Live and audible (started and not muted). While false, applied frames are dropped unheard -
   *  callers can skip building them at all. */
  get audible(): boolean {
    return this.canPlay();
  }

  /** The audio clock in seconds, the time base of every cooldown here; 0 before the context exists. */
  get clock(): number {
    return this.ctx?.currentTime ?? 0;
  }

  /**
   * Start (or resume) the audio context - must be called from within a user gesture the first time,
   * or the browser keeps it suspended. Creates the context lazily on first call. Safe to call repeatedly.
   */
  async resume(): Promise<void> {
    const ctx = this.ensureContext();
    if (ctx === null) return;
    const stalled = ctx.state === 'running' && this.clockStalled(ctx);
    if (ctx.state !== 'running' || stalled) {
      try {
        // A context that claims to run on a frozen clock restarts only through a suspend.
        if (stalled) await ctx.suspend();
        await ctx.resume();
      } catch {
        // A browser that refuses to resume outside a gesture just stays silent - not an error.
      }
    }
    // Music requested while suspended starts on the gesture that unlocked audio.
    this.assertMusic();
  }

  /** Mute/unmute without tearing down state: the master fades out, and running ambient loops and music
   *  stop under it. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.rampChannel('master', CLICK_FREE_RAMP_S);
    if (!enabled) {
      this.mixer?.stopAll();
      this.music?.stop();
      this.weather?.stop();
    } else {
      this.assertMusic();
    }
  }

  /** The page went to the background (hidden or unfocused) or came back. */
  setPageInBackground(inBackground: boolean): void {
    if (inBackground === this.pageInBackground) return;
    this.pageInBackground = inBackground;
    this.rampChannel('master', BACKGROUND_FADE_S);
  }

  /** Whether the mix keeps sounding while the page is in the background. Off fades the master to
   *  silence there and back on return; unlike {@link setEnabled}, music and beds run on underneath. */
  setPlayInBackground(play: boolean): void {
    if (play === this.playInBackground) return;
    this.playInBackground = play;
    this.rampChannel('master', BACKGROUND_FADE_S);
  }

  /** Fold the whole mix to mono for a player who hears on one ear. Each sound keeps its pan, which
   *  then only sets its share of the one channel. */
  setMono(mono: boolean): void {
    if (mono === this.mono) return;
    this.mono = mono;
    if (this.master !== null) foldMaster(this.master, mono);
  }

  /**
   * Decode `samples` into the sample cache in order, once a gesture has created the context; null when
   * the engine closes first or the platform has no Web Audio.
   */
  async preload(samples: readonly PreloadSample[]): Promise<SoundPreloadReport | null> {
    const cache = await this.samplesReady;
    if (cache === null || this.closed) return null;
    const startMs = this.now();
    const report = await cache.preload(samples);
    return { ...report, elapsedMs: this.now() - startMs, sampleRate: this.ctx?.sampleRate ?? 0 };
  }

  /**
   * Release the audio context and go permanently silent. A view that hands over to another one closes
   * its engine, so a page never accumulates contexts past the browser's cap.
   */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.settleSamples(null);
    const ctx = this.ctx;
    if (ctx === null) return;
    this.mixer?.stopAll();
    this.music?.stop();
    this.weather?.stop();
    // Fade the master first: closing a context cuts whatever still sounds mid-wave.
    this.rampChannel('master', CLICK_FREE_RAMP_S);
    setTimeout(() => {
      void ctx.close().catch(() => undefined); // a context already closed elsewhere rejects
    }, CLOSE_GRACE_S * 1000);
  }

  /** Which music should be playing (null = none); takes effect once playback is live. */
  setMusic(sequence: MusicSequence | null): void {
    this.desiredMusic = sequence;
    if (this.canPlay()) this.music?.play(sequence);
  }

  /** Act on a mood change of the playing sequence (see {@link MusicTransition}). */
  transitionMusic(transition: MusicTransition): void {
    if (!this.canPlay()) return;
    switch (transition) {
      case 'now':
        this.music?.interrupt();
        break;
      case 'keep':
        this.music?.keepOrInterrupt();
        break;
      case 'atPassEnd':
        this.music?.endAtPassEnd();
        break;
      case 'none':
        break;
    }
  }

  /** Set the slider positions; each moved bus ramps over {@link VOLUME_RAMP_S}. */
  setVolumes(volumes: MixerVolumes): void {
    for (const channel of VOLUME_CHANNELS) {
      const position = clampVolume(volumes[channel]);
      if (position === this.volumes[channel]) continue;
      this.volumes[channel] = position;
      this.rampChannel(channel, VOLUME_RAMP_S);
    }
  }

  /**
   * The camera scale this frame sees the world at. A changed zoom ramps the layer gains over
   * {@link PERSPECTIVE_RAMP_S}; an unchanged one, or any zoom closer than 1:1, schedules nothing.
   */
  setCameraScale(scale: number | undefined): void {
    const zoom = zoomDistance(scale);
    if (zoom === this.zoom) return;
    this.zoom = zoom;
    const ctx = this.ctx;
    const layers = this.layers;
    if (ctx === null || layers === null) return;
    for (const bus of WORLD_BUSES) {
      for (const layer of SHOT_LAYERS) {
        rampParam(ctx, layers.shots[bus][layer].gain, perspectiveGain(layer, zoom), PERSPECTIVE_RAMP_S);
      }
    }
    rampParam(ctx, layers.bed.gain, perspectiveGain('bed', zoom), PERSPECTIVE_RAMP_S);
    for (const filter of layers.filters)
      rampParam(ctx, filter.frequency, muffleCutoffHz(zoom), PERSPECTIVE_RAMP_S);
  }

  /** Apply one decided frame: fire its one-shots, reconcile its ambient loops, settle the duck. */
  apply(frame: AudioFrame): void {
    const ctx = this.ctx;
    if (!this.canPlay() || ctx === null || this.mixer === null) return;
    this.fire(frame.oneShots);
    this.mixer.reconcile(frame.ambient);
    this.updateMusicDuck(ctx);
    for (const duck of this.alertDucks) duck.update(ctx);
    this.voiceDuck?.update(ctx);
  }

  /** Play one frame of weather; `gameSeconds` is the clock the conditions advanced by (see
   *  {@link WeatherSoundscape.update}). Null conditions fade the weather out. */
  applyWeather(conditions: WeatherSoundInput | null, gameSeconds: number): void {
    if (!this.canPlay()) return;
    this.weather?.update(conditions, gameSeconds);
  }

  /** The graphics "Weather" switch: off silences the weather and forgets its pending thunder. */
  setWeatherEnabled(enabled: boolean): void {
    this.weatherEnabled = enabled;
    this.weather?.setEnabled(enabled);
  }

  /** The decoded length of `file` in seconds, or undefined until its wav has loaded. */
  clipLengthS(file: string): number | undefined {
    return this.samples?.duration(file);
  }

  /** Fade out the world one-shot started as `instance` and stop it once silent; a stop that lands while
   *  its wav still loads keeps it from starting at all. */
  stopOneShot(instance: number): void {
    const playing = this.stoppable.get(instance);
    this.stoppable.delete(instance);
    const ctx = this.ctx;
    if (playing === undefined || playing === null || ctx === null) return;
    rampParam(ctx, playing.gain.gain, 0, CLICK_FREE_RAMP_S);
    playing.source.stop(ctx.currentTime + CLICK_FREE_RAMP_S);
  }

  /** Fire one-shots outside a frame decision - a GUI cue answering an input event right away. */
  fire(shots: readonly OneShot[]): void {
    const ctx = this.ctx;
    if (!this.canPlay() || ctx === null || this.samples === null) return;
    for (const shot of shots) this.playOneShot(ctx, this.samples, shot);
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
    this.music?.play(this.desiredMusic);
  }

  /** Live and audible: not muted or closed, context created + resumed. Re-checked after every async load. */
  private canPlay(): boolean {
    return (
      this.enabled &&
      !this.closed &&
      this.ctx !== null &&
      this.ctx.state === 'running' &&
      this.master !== null
    );
  }

  /** Whether a running context's clock has stood still for {@link CLOCK_STALL_MS} of wall time. */
  private clockStalled(ctx: AudioContext): boolean {
    const nowMs = this.now();
    if (ctx.currentTime !== this.lastClock.audio) {
      this.lastClock = { audio: ctx.currentTime, wallMs: nowMs };
      return false;
    }
    return nowMs - this.lastClock.wallMs >= CLOCK_STALL_MS;
  }

  /** The gain a channel's node should hold now; a muted, closed or backgrounded engine holds its master
   *  at silence. */
  private channelGain(channel: VolumeChannel): number {
    if (channel === 'master') {
      const backgrounded = this.pageInBackground && !this.playInBackground;
      const silent = !this.enabled || this.closed || backgrounded;
      return silent ? 0 : volumeGain(this.volumes.master);
    }
    if (channel === 'music') return musicBusGain(this.volumes.music);
    return volumeGain(this.volumes[channel]);
  }

  private rampChannel(channel: VolumeChannel, seconds: number): void {
    const node = channel === 'master' ? this.master : (this.buses?.[channel] ?? null);
    if (this.ctx === null || node === null) return;
    rampParam(this.ctx, node.gain, this.channelGain(channel), seconds);
  }

  private ensureContext(): AudioContext | null {
    if (this.ctx !== null) return this.ctx;
    const ctx = this.createContext();
    if (ctx === null) {
      this.settleSamples(null);
      return null; // no Web Audio (headless/unsupported) → silent
    }
    this.ctx = ctx;
    const master = ctx.createGain();
    master.gain.value = this.channelGain('master');
    foldMaster(master, this.mono);
    const limiter = createPeakLimiter(ctx);
    if (limiter === null) master.connect(ctx.destination);
    else master.connect(limiter).connect(ctx.destination);
    const buses: Record<SoundBus, GainNode> = {
      music: ctx.createGain(),
      voice: ctx.createGain(),
      world: ctx.createGain(),
      ambient: ctx.createGain(),
      ui: ctx.createGain(),
    };
    for (const bus of SOUND_BUSES) buses[bus].gain.value = this.channelGain(bus);
    // The ducks sit behind their bus so a slider move and a running duck compose.
    const musicDuck = ctx.createGain();
    musicDuck.gain.value = 1;
    for (const bus of SOUND_BUSES) {
      if (bus !== 'music' && !ALERT_DUCKED_BUSES.includes(bus)) buses[bus].connect(master);
    }
    const layers = this.createLayers(ctx, buses);
    this.alertDucks = ALERT_DUCKED_BUSES.map((bus) => {
      const duck = new BusDuck(ctx);
      buses[bus].connect(duck.node).connect(master);
      return duck;
    });
    const voiceDuck = new BusDuck(ctx, VOICE_DUCK_RELEASE_S);
    buses.music.connect(musicDuck).connect(voiceDuck.node).connect(master);
    this.voiceDuck = voiceDuck;
    this.master = master;
    this.buses = buses;
    this.layers = layers;
    this.musicDuck = musicDuck;
    this.samples = new SampleCache(this.baseUrl, this.fetchBytes, (bytes) => ctx.decodeAudioData(bytes));
    this.settleSamples(this.samples);
    this.mixer = new AmbientMixer(ctx, layers.bed, this.samples, () => this.canPlay());
    this.music = new MusicPlayer(ctx, buses.music, this.musicBaseUrl, this.fetchBytes, () => this.canPlay());
    // Weather rides the ambient bed layer beside the terrain beds, so the same slider and zoom set it.
    this.weather = new WeatherSoundscape(ctx, layers.bed);
    this.weather.setEnabled(this.weatherEnabled);
    ctx.onstatechange = () => this.onStateChange(ctx);
    return ctx;
  }

  /** The layer gains, set for the zoom already known, each feeding its bus (a muffled one through its
   *  low-pass). */
  private createLayers(ctx: AudioContext, buses: Readonly<Record<SoundBus, GainNode>>): LayerGains {
    const filters: BiquadFilterNode[] = [];
    const layerGain = (layer: PerspectiveLayer, bus: GainNode): GainNode => {
      const gain = ctx.createGain();
      gain.gain.value = perspectiveGain(layer, this.zoom);
      if (!PERSPECTIVE_CURVES[layer].muffled) {
        gain.connect(bus);
        return gain;
      }
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = MUFFLE_Q_DB;
      filter.frequency.value = muffleCutoffHz(this.zoom);
      gain.connect(filter).connect(bus);
      filters.push(filter);
      return gain;
    };
    const shotLayers = (bus: GainNode): Record<ShotLayer, GainNode> => ({
      detail: layerGain('detail', bus),
      impact: layerGain('impact', bus),
    });
    return {
      shots: { world: shotLayers(buses.world), voice: shotLayers(buses.voice) },
      bed: layerGain('bed', buses.ambient),
      filters,
    };
  }

  /** Where a one-shot enters the mix: its layer's gain on a world bus, else its bus itself. */
  private shotInput(shot: OneShot, buses: Readonly<Record<SoundBus, GainNode>>): AudioNode {
    const bus = oneShotBus(shot);
    const layer = shotLayer(shot);
    if (layer === null || this.layers === null || (bus !== 'world' && bus !== 'voice')) return buses[bus];
    return this.layers.shots[bus][layer];
  }

  /**
   * The browser or the OS can suspend a running context (a phone call, sleep, an idle tab). Ask for it
   * back at once, which a document with sticky activation is granted; otherwise the next gesture's
   * {@link resume} brings it back. A context running again re-asserts the music a dropped load forgot.
   */
  private onStateChange(ctx: AudioContext): void {
    if (this.closed || ctx.state === 'closed') return;
    if (ctx.state === 'running') this.assertMusic();
    else void this.resume();
  }

  /** Play a decided one-shot on its first wav: the arbiter has already picked it and applied every
   *  cooldown and exclusivity guard. */
  private playOneShot(ctx: AudioContext, samples: SampleCache, shot: OneShot): void {
    const file = shot.files[0];
    if (file === undefined) return;
    const instance = shot.instance;
    if (instance !== undefined) this.stoppable.set(instance, null);
    // A delay counts from the decision, so a layer whose wav loads late does not drift further behind.
    const startAt = ctx.currentTime + (shot.delayS ?? 0);
    void samples.get(file).then((buffer) => {
      const buses = this.buses;
      const stopped = instance !== undefined && !this.stoppable.has(instance);
      if (buffer === null || !this.canPlay() || buses === null || stopped) {
        if (instance !== undefined) this.stoppable.delete(instance);
        return;
      }
      const start = Math.max(startAt, ctx.currentTime);
      // The ducks follow the shots that actually ring: a missing or undecodable wav dims nothing. A dip
      // holds from now to the end of the delayed, rate-stretched wav.
      if (shot.duckMusicMs !== undefined) this.duckMusic(ctx, shot.duckMusicMs);
      const holdS = start - ctx.currentTime + buffer.duration / (shot.rate ?? 1);
      if (shot.duckWorldDb !== undefined) {
        for (const duck of this.alertDucks) duck.hold(ctx, shot.duckWorldDb, holdS);
      }
      if (shot.duckMusicDb !== undefined) this.voiceDuck?.hold(ctx, shot.duckMusicDb, holdS);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      if (shot.rate !== undefined) source.playbackRate.value = shot.rate;
      const gain = ctx.createGain();
      gain.gain.value = shot.gain;
      // StereoPannerNode is absent on some old `webkitAudioContext` builds; degrade to unpanned rather
      // than throwing inside this un-awaited promise (which would silently drop all positional SFX).
      const head = this.pannerFor(ctx, shot.pan) ?? source;
      if (head !== source) source.connect(head);
      head.connect(gain).connect(this.shotInput(shot, buses));
      if (instance !== undefined) {
        this.stoppable.set(instance, { source, gain });
        source.onended = () => this.stoppable.delete(instance);
      }
      source.start(start);
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

function clampedVolumes(volumes: MixerVolumes): Record<VolumeChannel, number> {
  return {
    master: clampVolume(volumes.master),
    music: clampVolume(volumes.music),
    voice: clampVolume(volumes.voice),
    world: clampVolume(volumes.world),
    ambient: clampVolume(volumes.ambient),
    ui: clampVolume(volumes.ui),
  };
}

/** Mix the master's inputs down to one channel, or let it carry as many as they bring. */
function foldMaster(master: GainNode, mono: boolean): void {
  master.channelCountMode = mono ? 'explicit' : 'max';
  if (mono) master.channelCount = MONO_CHANNELS;
  master.channelInterpretation = 'speakers';
}

/** The master's peak limiter, or null on a context that cannot make a compressor (it then plays
 *  unlimited rather than not at all). */
function createPeakLimiter(ctx: AudioContext): DynamicsCompressorNode | null {
  if (typeof ctx.createDynamicsCompressor !== 'function') return null;
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = LIMITER_THRESHOLD_DB;
  limiter.knee.value = LIMITER_KNEE_DB;
  limiter.ratio.value = LIMITER_RATIO;
  limiter.attack.value = LIMITER_ATTACK_S;
  limiter.release.value = LIMITER_RELEASE_S;
  return limiter;
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
