import {
  WEATHER_SILENT_GAIN,
  type WeatherMix,
  type WeatherSoundInput,
  weatherMix,
} from '../../data/weather/mix.js';
import { seededRandom, type ThunderPlan, ThunderQueue } from '../../data/weather/thunder.js';
import { createWeatherBuffers, type WeatherBuffers } from './weather-noise.js';

/**
 * Plays the weather: a graph of looping shaped-noise layers whose levels and filters follow
 * {@link weatherMix}, plus one thunder voice per strike. The graph exists only while some weather is
 * audible; once silent for {@link WEATHER_TEARDOWN_S} its sources stop and its nodes disconnect, so a
 * dry map costs nothing. Every continuous change glides with `setTargetAtTime`, never a jump.
 */

/** Time constant of every level and filter glide. Approximation. */
export const WEATHER_SMOOTH_S = 0.4;
/** A graph silent this long (audio seconds) is torn down. */
export const WEATHER_TEARDOWN_S = 3;
/** Fade before a switched-off or muted graph stops. */
export const WEATHER_STOP_FADE_S = 0.5;
/** A target moving less than this share of its value is not re-sent to the audio thread. */
const PARAM_EPSILON = 1e-3;

/** Rain hiss top end, fixed. Approximation. */
export const RAIN_HISS_LOWPASS_HZ = 9000;
/** Wind band-pass width and its slow wander, independent of the gust. Approximation. */
export const WIND_BAND_Q = 0.8;
export const WIND_WANDER_HZ = 0.07;
export const WIND_WANDER_DEPTH_HZ = 90;
/** Whistle resonances: sharpness and the overtone's pitch ratio over the fundamental. Approximation. */
export const WHISTLE_Q = 30;
export const WHISTLE_OVERTONE_RATIO = 1.53;
/** Two stacked low-passes over the rumble: 24 dB per octave, so far thunder is truly dull. */
const THUNDER_LOWPASS_STAGES = 2;
/** The rumble dips to this share of the next swell between two swells. Approximation. */
export const THUNDER_DIP_SHARE = 0.35;
/** Thunder envelopes start this far ahead of the audio clock, so no ramp lands in the past. */
const THUNDER_LEAD_S = 0.02;
/** Crack shape: attack, decay time constant, total length, and its top end. Approximation. */
export const THUNDER_CRACK_ATTACK_S = 0.004;
export const THUNDER_CRACK_DECAY_S = 0.09;
export const THUNDER_CRACK_LENGTH_S = 0.8;
export const THUNDER_CRACK_LOWPASS_HZ = 6000;

type MixParam = Exclude<keyof WeatherMix, 'silent'>;

/** One param a mix value drives, times a fixed factor (the whistle overtone follows its fundamental). */
interface Target {
  readonly param: AudioParam;
  readonly factor: number;
}

interface Bed {
  readonly out: GainNode;
  readonly sources: readonly AudioBufferSourceNode[];
  readonly wander: OscillatorNode;
  readonly nodes: readonly AudioNode[];
  readonly targets: Readonly<Record<MixParam, readonly Target[]>>;
  readonly sent: Record<MixParam, number>;
}

interface ThunderVoice {
  readonly sources: readonly AudioBufferSourceNode[];
  /** The gains carrying its envelopes, faded on a stop so it does not click off. */
  readonly envelopes: readonly GainNode[];
  readonly nodes: readonly AudioNode[];
}

const MIX_PARAMS: readonly MixParam[] = [
  'rainHissGain',
  'rainHissHighpassHz',
  'rainBodyGain',
  'rainBodyLowpassHz',
  'patterSparseGain',
  'patterDenseGain',
  'windGain',
  'windBandHz',
  'windLowpassHz',
  'whistleGain',
  'whistleHz',
  'gritGain',
  'gritHighpassHz',
];

export class WeatherSoundscape {
  private buffers: WeatherBuffers | null = null;
  private bed: Bed | null = null;
  /** Audio time the mix went silent, null while something sounds. */
  private silentSince: number | null = null;
  private readonly thunder = new ThunderQueue();
  private readonly voices = new Set<ThunderVoice>();
  private enabled = true;

  constructor(
    private readonly ctx: BaseAudioContext,
    /** The bus weather plays into (the game-sounds bus, so its slider applies). */
    private readonly out: AudioNode,
  ) {}

  /** Whether a layer graph currently exists (for tests and diagnostics). */
  get active(): boolean {
    return this.bed !== null;
  }

  /** Live thunder voices (for tests and diagnostics). */
  get thunderVoices(): number {
    return this.voices.size;
  }

  /** The graphics "Weather" switch: off fades everything out and forgets pending thunder. */
  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (!enabled) this.stop();
  }

  /**
   * One rendered frame. `gameSeconds` is the game clock the conditions were advanced by: thunder
   * arrives by it, so a paused game keeps its rain bed steady but releases no new thunder.
   */
  update(input: WeatherSoundInput | null, gameSeconds: number): void {
    if (!this.enabled) return;
    const mix = weatherMix(input);
    const now = this.ctx.currentTime;
    if (mix.silent) {
      if (this.bed !== null) {
        this.retarget(this.bed, mix, now);
        this.silentSince ??= now;
        if (now - this.silentSince >= WEATHER_TEARDOWN_S) this.releaseBed(now);
      }
    } else {
      this.silentSince = null;
      if (this.bed === null) this.bed = this.buildBed(mix);
      else this.retarget(this.bed, mix, now);
    }
    for (const plan of this.thunder.advance(input?.strikes ?? [], gameSeconds)) this.playThunder(plan);
  }

  /** Fade out and release everything now: mute, weather off, or the engine closing. */
  stop(): void {
    this.thunder.clear();
    const now = this.ctx.currentTime;
    this.releaseBed(now);
    for (const voice of this.voices) {
      for (const envelope of voice.envelopes) {
        envelope.gain.cancelScheduledValues(now);
        envelope.gain.setValueAtTime(envelope.gain.value, now);
        envelope.gain.linearRampToValueAtTime(0, now + WEATHER_STOP_FADE_S);
      }
      for (const source of voice.sources) stopSource(source, now + WEATHER_STOP_FADE_S);
    }
  }

  private retarget(bed: Bed, mix: WeatherMix, now: number): void {
    for (const key of MIX_PARAMS) {
      const value = mix[key];
      const sent = bed.sent[key];
      if (Math.abs(value - sent) <= PARAM_EPSILON * Math.max(WEATHER_SILENT_GAIN, Math.abs(sent))) continue;
      bed.sent[key] = value;
      for (const t of bed.targets[key]) t.param.setTargetAtTime(value * t.factor, now, WEATHER_SMOOTH_S);
    }
  }

  private buildBed(mix: WeatherMix): Bed {
    const ctx = this.ctx;
    this.buffers ??= createWeatherBuffers(ctx);
    const buffers = this.buffers;
    const nodes: AudioNode[] = [];
    const sources: AudioBufferSourceNode[] = [];
    const out = ctx.createGain();
    out.gain.value = 1;
    out.connect(this.out);
    nodes.push(out);
    const loop = (buffer: AudioBuffer, offsetShare: number): AudioBufferSourceNode => {
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.start(0, buffer.duration * offsetShare);
      sources.push(source);
      return source;
    };
    const filter = (type: BiquadFilterType, hz: number, q = Math.SQRT1_2): BiquadFilterNode => {
      const node = ctx.createBiquadFilter();
      node.type = type;
      node.frequency.value = hz;
      node.Q.value = q;
      nodes.push(node);
      return node;
    };
    // Every layer gain starts silent and glides up, so a new graph fades in.
    const layer = (): GainNode => {
      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.connect(out);
      nodes.push(gain);
      return gain;
    };
    // The same white loop feeds several layers from different offsets, so they stay uncorrelated.
    const hissHigh = filter('highpass', mix.rainHissHighpassHz);
    const hissGain = layer();
    loop(buffers.white, 0)
      .connect(hissHigh)
      .connect(filter('lowpass', RAIN_HISS_LOWPASS_HZ))
      .connect(hissGain);
    const bodyLow = filter('lowpass', mix.rainBodyLowpassHz);
    const bodyGain = layer();
    loop(buffers.brown, 0).connect(bodyLow).connect(bodyGain);
    const sparseGain = layer();
    loop(buffers.patterSparse, 0).connect(sparseGain);
    const denseGain = layer();
    loop(buffers.patterDense, 0).connect(denseGain);
    const windBand = filter('bandpass', mix.windBandHz, WIND_BAND_Q);
    const windLow = filter('lowpass', mix.windLowpassHz);
    const windGain = layer();
    loop(buffers.pink, 0).connect(windBand).connect(windLow).connect(windGain);
    // A slow wander on the wind band on top of the gust, so a steady wind still moves.
    const wander = ctx.createOscillator();
    wander.frequency.value = WIND_WANDER_HZ;
    const wanderDepth = ctx.createGain();
    wanderDepth.gain.value = WIND_WANDER_DEPTH_HZ;
    wander.connect(wanderDepth).connect(windBand.frequency);
    wander.start();
    nodes.push(wanderDepth);
    const whistleGain = layer();
    const whistle = filter('bandpass', mix.whistleHz, WHISTLE_Q);
    const overtone = filter('bandpass', mix.whistleHz * WHISTLE_OVERTONE_RATIO, WHISTLE_Q);
    const whistleSource = loop(buffers.white, 1 / 2);
    whistleSource.connect(whistle).connect(whistleGain);
    whistleSource.connect(overtone).connect(whistleGain);
    const gritHigh = filter('highpass', mix.gritHighpassHz);
    const gritGain = layer();
    loop(buffers.grit, 0).connect(gritHigh).connect(gritGain);

    const one = (param: AudioParam): readonly Target[] => [{ param, factor: 1 }];
    const bed: Bed = {
      out,
      sources,
      wander,
      nodes,
      targets: {
        rainHissGain: one(hissGain.gain),
        rainHissHighpassHz: one(hissHigh.frequency),
        rainBodyGain: one(bodyGain.gain),
        rainBodyLowpassHz: one(bodyLow.frequency),
        patterSparseGain: one(sparseGain.gain),
        patterDenseGain: one(denseGain.gain),
        windGain: one(windGain.gain),
        windBandHz: one(windBand.frequency),
        windLowpassHz: one(windLow.frequency),
        whistleGain: one(whistleGain.gain),
        whistleHz: [
          { param: whistle.frequency, factor: 1 },
          { param: overtone.frequency, factor: WHISTLE_OVERTONE_RATIO },
        ],
        gritGain: one(gritGain.gain),
        gritHighpassHz: one(gritHigh.frequency),
      },
      // Filters already stand at the mix; gains are sent from zero so they glide in.
      sent: {
        ...mix,
        rainHissGain: 0,
        rainBodyGain: 0,
        patterSparseGain: 0,
        patterDenseGain: 0,
        windGain: 0,
        whistleGain: 0,
        gritGain: 0,
      },
    };
    this.retarget(bed, mix, ctx.currentTime);
    return bed;
  }

  /** Fade the bed out, stop its sources and disconnect it once they end. */
  private releaseBed(now: number): void {
    const bed = this.bed;
    if (bed === null) return;
    this.bed = null;
    this.silentSince = null;
    bed.out.gain.setTargetAtTime(0, now, WEATHER_STOP_FADE_S / 4);
    const end = now + WEATHER_STOP_FADE_S;
    const first = bed.sources[0];
    if (first !== undefined) {
      first.onended = () => {
        for (const source of bed.sources) source.disconnect();
        bed.wander.disconnect();
        for (const node of bed.nodes) node.disconnect();
      };
    }
    for (const source of bed.sources) stopSource(source, end);
    stopSource(bed.wander, end);
  }

  private playThunder(plan: ThunderPlan): void {
    const ctx = this.ctx;
    this.buffers ??= createWeatherBuffers(ctx);
    const buffers = this.buffers;
    const t0 = ctx.currentTime + THUNDER_LEAD_S;
    const random = seededRandom(plan.strikeId);
    const nodes: AudioNode[] = [];
    const sources: AudioBufferSourceNode[] = [];
    const envelopes: GainNode[] = [];

    const rumble = ctx.createBufferSource();
    rumble.buffer = buffers.brown;
    rumble.loop = true;
    let head: AudioNode = rumble;
    for (let stage = 0; stage < THUNDER_LOWPASS_STAGES; stage++) {
      const low = ctx.createBiquadFilter();
      low.type = 'lowpass';
      low.frequency.value = plan.lowpassHz;
      nodes.push(low);
      head = head.connect(low);
    }
    const envelope = ctx.createGain();
    nodes.push(envelope);
    envelopes.push(envelope);
    head.connect(envelope).connect(this.out);
    const gain = envelope.gain;
    gain.setValueAtTime(0, t0);
    let previousAt = 0;
    for (const [i, roll] of plan.rolls.entries()) {
      if (i > 0)
        gain.linearRampToValueAtTime(roll.gain * THUNDER_DIP_SHARE, t0 + (previousAt + roll.atS) / 2);
      gain.linearRampToValueAtTime(roll.gain, t0 + roll.atS);
      previousAt = roll.atS;
    }
    gain.linearRampToValueAtTime(0, t0 + plan.rumbleS);
    rumble.start(t0, buffers.brown.duration * random());
    rumble.stop(t0 + plan.rumbleS);
    sources.push(rumble);

    if (plan.crackGain > 0) {
      const crack = ctx.createBufferSource();
      crack.buffer = buffers.white;
      const low = ctx.createBiquadFilter();
      low.type = 'lowpass';
      low.frequency.value = THUNDER_CRACK_LOWPASS_HZ;
      const crackGain = ctx.createGain();
      crackGain.gain.setValueAtTime(0, t0);
      crackGain.gain.linearRampToValueAtTime(plan.crackGain, t0 + THUNDER_CRACK_ATTACK_S);
      crackGain.gain.setTargetAtTime(0, t0 + THUNDER_CRACK_ATTACK_S, THUNDER_CRACK_DECAY_S);
      crack.connect(low).connect(crackGain).connect(this.out);
      crack.start(t0, buffers.white.duration * random());
      crack.stop(t0 + THUNDER_CRACK_LENGTH_S);
      nodes.push(low, crackGain);
      envelopes.push(crackGain);
      sources.unshift(crack);
    }

    const voice: ThunderVoice = { sources, envelopes, nodes };
    this.voices.add(voice);
    // The rumble always outlasts the crack, so its end releases the whole voice.
    rumble.onended = () => {
      for (const source of voice.sources) source.disconnect();
      for (const node of voice.nodes) node.disconnect();
      this.voices.delete(voice);
    };
  }
}

function stopSource(source: AudioScheduledSourceNode, at: number): void {
  try {
    source.stop(at);
  } catch {
    // Already stopped.
  }
}
