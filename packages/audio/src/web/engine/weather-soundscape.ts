import {
  WEATHER_SILENT_GAIN,
  type WeatherMix,
  type WeatherSoundInput,
  weatherMix,
} from '../../data/weather/mix.js';
import { seededRandom, type ThunderPlan, ThunderQueue } from '../../data/weather/thunder.js';
import { createWeatherBuffers, SWELL_PLAYBACK_RATE, type WeatherBuffers } from './weather-noise.js';

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

/** Weather bus trim: one knob for the whole weather level under the game-sounds bus. */
export const WEATHER_OUTPUT_GAIN = 1;
/** Safety soft limiter on the weather bus: linear up to the knee, bending smoothly to the ceiling.
 *  Tuned levels stay under the knee; it only catches overlapping near strikes. */
export const WEATHER_LIMIT_KNEE = 0.5;
export const WEATHER_LIMIT_CEILING = 0.8;
/** Points in the limiter curve across -1..1; odd, so zero maps exactly to zero. */
const WEATHER_LIMIT_CURVE_POINTS = 1025;
/** Wind level and band follow the gust on this slower time constant, so gusts swell. Approximation. */
export const WIND_SMOOTH_S = 1.5;
/** Rain roar bottom: under it the roar would only be rumble. Approximation. */
export const RAIN_ROAR_HIGHPASS_HZ = 200;
/** Wind band-pass width. Approximation. */
export const WIND_BAND_Q = 0.8;
/** Swell modulation: rain level breathes by this share, wind level by this share, and the wind band
 *  wanders by this much, all following one slow irregular curve. Approximation. */
export const RAIN_BREATH_DEPTH = 0.3;
export const WIND_BREATH_DEPTH = 0.35;
export const WIND_WANDER_DEPTH_HZ = 60;
/** The wind reads the swell curve this far along its loop, so it moves apart from the rain. */
const WIND_SWELL_OFFSET_SHARE = 1 / 2;
/** Two stacked low-passes over the rumble: 24 dB per octave, so far thunder is truly dull. */
const THUNDER_LOWPASS_STAGES = 2;
/** Rumble high-pass: sub-audible energy under it would only eat headroom. */
export const THUNDER_RUMBLE_HIGHPASS_HZ = 28;
/** The rumble dips to this share of the next swell between two swells. Approximation. */
export const THUNDER_DIP_SHARE = 0.35;
/** Thunder envelopes start this far ahead of the audio clock, so no ramp lands in the past. */
const THUNDER_LEAD_S = 0.02;
/** Crack shape: attack, length of its exponential fade, and its low-pass top end. Approximation. */
export const THUNDER_CRACK_ATTACK_S = 0.015;
export const THUNDER_CRACK_LENGTH_S = 1.2;
export const THUNDER_CRACK_LOWPASS_HZ = 1200;
/** Exponential fades end at this share of their peak, then ramp linearly to true zero. */
const FADE_FLOOR_SHARE = 1e-3;
/** The final linear step from the fade floor to zero. */
const FADE_TO_ZERO_S = 0.05;

type MixParam = Exclude<keyof WeatherMix, 'silent'>;

/** One param a mix value drives, and how fast it glides there. */
interface Target {
  readonly param: AudioParam;
  readonly smoothS: number;
}

interface Bed {
  readonly out: GainNode;
  readonly sources: readonly AudioBufferSourceNode[];
  readonly nodes: readonly AudioNode[];
  readonly targets: Readonly<Record<MixParam, Target>>;
  readonly sent: Record<MixParam, number>;
}

interface ThunderVoice {
  readonly sources: readonly AudioBufferSourceNode[];
  /** The gains carrying its envelopes, faded on a stop so it does not click off. */
  readonly envelopes: readonly GainNode[];
  readonly nodes: readonly AudioNode[];
}

/** The weather's own output stage: trim gain, then the soft limiter into the game-sounds bus. */
interface WeatherBus {
  readonly input: GainNode;
  readonly limiter: WaveShaperNode;
  /** Beds (including fading ones) and thunder voices still wired into it. */
  users: number;
}

const MIX_PARAMS: readonly MixParam[] = [
  'rainHissGain',
  'rainHissHighpassHz',
  'rainHissLowpassHz',
  'rainRoarGain',
  'rainRoarLowpassHz',
  'dropsGain',
  'windGain',
  'windBandHz',
  'windLowpassHz',
  'gritGain',
  'gritHighpassHz',
];

export class WeatherSoundscape {
  private buffers: WeatherBuffers | null = null;
  private bus: WeatherBus | null = null;
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
      const target = bed.targets[key];
      target.param.setTargetAtTime(value, now, target.smoothS);
    }
  }

  /** The bus input, built on first use; every caller releases it with {@link releaseBus}. */
  private acquireBus(): GainNode {
    if (this.bus === null) {
      const input = this.ctx.createGain();
      input.gain.value = WEATHER_OUTPUT_GAIN;
      const limiter = this.ctx.createWaveShaper();
      limiter.curve = softLimitCurve();
      input.connect(limiter).connect(this.out);
      this.bus = { input, limiter, users: 0 };
    }
    this.bus.users++;
    return this.bus.input;
  }

  private releaseBus(): void {
    const bus = this.bus;
    if (bus === null) return;
    bus.users--;
    if (bus.users > 0) return;
    bus.input.disconnect();
    bus.limiter.disconnect();
    this.bus = null;
  }

  private buildBed(mix: WeatherMix): Bed {
    const ctx = this.ctx;
    this.buffers ??= createWeatherBuffers(ctx);
    const buffers = this.buffers;
    const nodes: AudioNode[] = [];
    const sources: AudioBufferSourceNode[] = [];
    const out = ctx.createGain();
    out.gain.value = 1;
    out.connect(this.acquireBus());
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
    const gainNode = (value: number, into: AudioNode): GainNode => {
      const gain = ctx.createGain();
      gain.gain.value = value;
      gain.connect(into);
      nodes.push(gain);
      return gain;
    };
    // A fixed gain from the swell curve into a param: the depth the curve moves it by.
    const depth = (value: number, param: AudioParam): GainNode => {
      const gain = ctx.createGain();
      gain.gain.value = value;
      gain.connect(param);
      nodes.push(gain);
      return gain;
    };
    // Rain and wind each breathe through a unity gain the slow swell curve pushes up and down.
    const rainBreath = gainNode(1, out);
    const windBreath = gainNode(1, out);
    // Every layer gain starts silent and glides up, so a new graph fades in.
    const layer = (into: AudioNode): GainNode => gainNode(0, into);

    const hissHigh = filter('highpass', mix.rainHissHighpassHz);
    const hissLow = filter('lowpass', mix.rainHissLowpassHz);
    const hissGain = layer(rainBreath);
    loop(buffers.white, 0).connect(hissHigh).connect(hissLow).connect(hissGain);
    const roarLow = filter('lowpass', mix.rainRoarLowpassHz);
    const roarGain = layer(rainBreath);
    loop(buffers.pink, 0)
      .connect(filter('highpass', RAIN_ROAR_HIGHPASS_HZ))
      .connect(roarLow)
      .connect(roarGain);
    const dropsGain = layer(rainBreath);
    loop(buffers.drops, 0).connect(dropsGain);
    const windBand = filter('bandpass', mix.windBandHz, WIND_BAND_Q);
    const windLow = filter('lowpass', mix.windLowpassHz);
    const windGain = layer(windBreath);
    // The same pink loop feeds the roar and the wind from different offsets, so they stay uncorrelated.
    loop(buffers.pink, 1 / 2)
      .connect(windBand)
      .connect(windLow)
      .connect(windGain);
    const gritHigh = filter('highpass', mix.gritHighpassHz);
    const gritGain = layer(out);
    loop(buffers.grit, 0).connect(gritHigh).connect(gritGain);

    const swell = (offsetShare: number): AudioBufferSourceNode => {
      const source = loop(buffers.swell, offsetShare);
      source.playbackRate.value = SWELL_PLAYBACK_RATE;
      return source;
    };
    swell(0).connect(depth(RAIN_BREATH_DEPTH, rainBreath.gain));
    const windSwell = swell(WIND_SWELL_OFFSET_SHARE);
    windSwell.connect(depth(WIND_BREATH_DEPTH, windBreath.gain));
    windSwell.connect(depth(WIND_WANDER_DEPTH_HZ, windBand.frequency));

    const glide = (param: AudioParam): Target => ({ param, smoothS: WEATHER_SMOOTH_S });
    const gustGlide = (param: AudioParam): Target => ({ param, smoothS: WIND_SMOOTH_S });
    const bed: Bed = {
      out,
      sources,
      nodes,
      targets: {
        rainHissGain: glide(hissGain.gain),
        rainHissHighpassHz: glide(hissHigh.frequency),
        rainHissLowpassHz: glide(hissLow.frequency),
        rainRoarGain: glide(roarGain.gain),
        rainRoarLowpassHz: glide(roarLow.frequency),
        dropsGain: glide(dropsGain.gain),
        windGain: gustGlide(windGain.gain),
        windBandHz: gustGlide(windBand.frequency),
        windLowpassHz: glide(windLow.frequency),
        gritGain: gustGlide(gritGain.gain),
        gritHighpassHz: glide(gritHigh.frequency),
      },
      // Filters already stand at the mix; gains are sent from zero so they glide in.
      sent: { ...mix, rainHissGain: 0, rainRoarGain: 0, dropsGain: 0, windGain: 0, gritGain: 0 },
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
        for (const node of bed.nodes) node.disconnect();
        this.releaseBus();
      };
    }
    for (const source of bed.sources) stopSource(source, end);
  }

  private playThunder(plan: ThunderPlan): void {
    const ctx = this.ctx;
    this.buffers ??= createWeatherBuffers(ctx);
    const buffers = this.buffers;
    const bus = this.acquireBus();
    const t0 = ctx.currentTime + THUNDER_LEAD_S;
    const random = seededRandom(plan.strikeId);
    const nodes: AudioNode[] = [];
    const sources: AudioBufferSourceNode[] = [];
    const envelopes: GainNode[] = [];
    const filter = (type: BiquadFilterType, hz: number): BiquadFilterNode => {
      const node = ctx.createBiquadFilter();
      node.type = type;
      node.frequency.value = hz;
      nodes.push(node);
      return node;
    };

    const rumble = ctx.createBufferSource();
    rumble.buffer = buffers.brown;
    rumble.loop = true;
    let head: AudioNode = rumble.connect(filter('highpass', THUNDER_RUMBLE_HIGHPASS_HZ));
    for (let stage = 0; stage < THUNDER_LOWPASS_STAGES; stage++)
      head = head.connect(filter('lowpass', plan.lowpassHz));
    const envelope = ctx.createGain();
    nodes.push(envelope);
    envelopes.push(envelope);
    head.connect(envelope).connect(bus);
    const gain = envelope.gain;
    gain.setValueAtTime(0, t0);
    let previousAt = 0;
    let lastGain = 0;
    for (const [i, roll] of plan.rolls.entries()) {
      if (i > 0)
        gain.linearRampToValueAtTime(roll.gain * THUNDER_DIP_SHARE, t0 + (previousAt + roll.atS) / 2);
      gain.linearRampToValueAtTime(roll.gain, t0 + roll.atS);
      previousAt = roll.atS;
      lastGain = roll.gain;
    }
    // A long exponential tail after the last swell, then a short step to true zero.
    const end = t0 + plan.rumbleS;
    if (lastGain > 0) gain.exponentialRampToValueAtTime(lastGain * FADE_FLOOR_SHARE, end - FADE_TO_ZERO_S);
    gain.linearRampToValueAtTime(0, end);
    rumble.start(t0, buffers.brown.duration * random());
    rumble.stop(end);
    sources.push(rumble);

    if (plan.crackGain > 0) {
      const crack = ctx.createBufferSource();
      crack.buffer = buffers.pink;
      const crackGain = ctx.createGain();
      const crackEnd = t0 + THUNDER_CRACK_LENGTH_S;
      crackGain.gain.setValueAtTime(0, t0);
      crackGain.gain.linearRampToValueAtTime(plan.crackGain, t0 + THUNDER_CRACK_ATTACK_S);
      crackGain.gain.exponentialRampToValueAtTime(
        plan.crackGain * FADE_FLOOR_SHARE,
        crackEnd - FADE_TO_ZERO_S,
      );
      crackGain.gain.linearRampToValueAtTime(0, crackEnd);
      crack.connect(filter('lowpass', THUNDER_CRACK_LOWPASS_HZ)).connect(crackGain).connect(bus);
      crack.start(t0, buffers.pink.duration * random());
      crack.stop(crackEnd);
      nodes.push(crackGain);
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
      this.releaseBus();
    };
  }
}

/** Identity under {@link WEATHER_LIMIT_KNEE}, then a tanh bend that never passes the ceiling. */
function softLimitCurve(): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(WEATHER_LIMIT_CURVE_POINTS);
  const room = WEATHER_LIMIT_CEILING - WEATHER_LIMIT_KNEE;
  for (let i = 0; i < curve.length; i++) {
    const x = (2 * i) / (curve.length - 1) - 1;
    const over = Math.abs(x) - WEATHER_LIMIT_KNEE;
    curve[i] = over <= 0 ? x : Math.sign(x) * (WEATHER_LIMIT_KNEE + room * Math.tanh(over / room));
  }
  return curve;
}

function stopSource(source: AudioScheduledSourceNode, at: number): void {
  try {
    source.stop(at);
  } catch {
    // Already stopped.
  }
}
