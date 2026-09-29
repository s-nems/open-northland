import type { WeatherConditions } from '@open-northland/render/data';
import { clamp, lerpHz } from '../math.js';

/**
 * The weather soundscape's decision: what each synthesized layer should sound like for the conditions
 * on screen. The original plays no weather sound at all, so every level, band and curve here is an
 * approximation tuned by reasoning about real rain, wind and sand and by measuring offline renders.
 */

/** The part of the render's weather conditions the soundscape reads. */
export type WeatherSoundInput = Pick<WeatherConditions, 'amounts' | 'storm' | 'gust' | 'strikes'>;

/** Target levels and filter settings for every continuous layer; gains are linear amplitude. */
export interface WeatherMix {
  /** True when every layer is silent: playback may tear its graph down. */
  readonly silent: boolean;
  /** Broadband rain hiss between a high-pass and a low-pass: bright in a drizzle, duller in a downpour. */
  readonly rainHissGain: number;
  readonly rainHissHighpassHz: number;
  readonly rainHissLowpassHz: number;
  /** Low-mid roar of heavy rain and the low-pass that sets its top. */
  readonly rainRoarGain: number;
  readonly rainRoarLowpassHz: number;
  /** Soft drop bursts that fuse into a patter, heard mostly in light rain. */
  readonly dropsGain: number;
  /** Band-passed wind noise, then a low-pass that muffles it (snow) or opens it (sand). */
  readonly windGain: number;
  readonly windBandHz: number;
  readonly windLowpassHz: number;
  /** Gritty high hiss of blown sand. */
  readonly gritGain: number;
  readonly gritHighpassHz: number;
}

/** An amount (0..1, the original's density share) that already sounds as full weather. Script
 *  weather in real maps writes 0.05..0.3, so the sound saturates well below 1. Approximation. */
export const WEATHER_AMOUNT_FOR_FULL_SOUND = 0.4;
/** Below this total amount the weather is inaudible and the graph may go. */
export const WEATHER_SILENT_AMOUNT = 0.002;
/** A gain below this counts as silent. */
export const WEATHER_SILENT_GAIN = 1e-4;

/** Layer ceilings, linear amplitude on unit-RMS-scaled noise into the weather bus. Approximations
 *  measured so a full storm bed sits near -30 dBFS RMS and light rain near -40, far under gameplay. */
export const RAIN_HISS_MAX_GAIN = 0.14;
export const RAIN_ROAR_MAX_GAIN = 0.16;
export const DROPS_MAX_GAIN = 0.06;
export const WIND_MAX_GAIN = 0.25;
export const GRIT_MAX_GAIN = 0.05;

/** Rain hiss band: a drizzle is a soft mid hiss, a downpour opens lower and loses more of its top. */
export const RAIN_HISS_LIGHT_HIGHPASS_HZ = 900;
export const RAIN_HISS_HEAVY_HIGHPASS_HZ = 700;
export const RAIN_HISS_LIGHT_LOWPASS_HZ = 5500;
export const RAIN_HISS_HEAVY_LOWPASS_HZ = 4500;
/** Share of the hiss a downpour keeps: the roar takes over as the rain gets heavy. */
export const RAIN_HISS_HEAVY_SHARE = 0.4;
/** Rain roar top from moderate to heavy rain; its bottom is fixed in playback. Approximation. */
export const RAIN_ROAR_LIGHT_LOWPASS_HZ = 1500;
export const RAIN_ROAR_HEAVY_LOWPASS_HZ = 1000;
/** Share of the drop level a downpour ducks away, where drops fuse into the roar. */
export const DROPS_HEAVY_DUCK = 0.8;
/** How much of the storm value adds to rain heaviness on top of its amount. Approximation. */
export const RAIN_STORM_HEAVINESS = 0.4;

/** How strongly each kind raises the wind, per unit of its sound intensity: snow and sand are
 *  wind-borne, rain only brings wind in a storm. Approximation. */
export const WIND_FROM_RAIN = 0.15;
export const WIND_FROM_SNOW = 0.45;
export const WIND_FROM_SAND = 0.8;
/** Wind a full storm adds on top. Approximation. */
export const WIND_FROM_STORM = 0.55;
/** Share of the wind level that swells with the gust; the rest is the steady bed. */
export const GUST_SWELL_DEPTH = 0.45;
/** Wind band centre from calm to full gust. Approximation. */
export const WIND_CALM_HZ = 180;
export const WIND_GUST_HZ = 480;
/** Wind muffling low-pass per kind: snow is soft and dull, rain in between, sand more open. */
export const WIND_LOWPASS_SNOW_HZ = 500;
export const WIND_LOWPASS_RAIN_HZ = 900;
export const WIND_LOWPASS_SAND_HZ = 2400;

/** Sand grit high-pass, lowering (coarser) in a sandstorm. Approximation. */
export const GRIT_CALM_HZ = 3400;
export const GRIT_STORM_HZ = 2200;
/** Share of the grit level that swells with the gust. */
export const GRIT_GUST_DEPTH = 0.5;

/** Perceived intensity 0..1 of an amount: a square-root curve so thin weather is still audible. */
export function soundIntensity(amount: number): number {
  return Math.sqrt(clamp(amount / WEATHER_AMOUNT_FOR_FULL_SOUND, 0, 1));
}

const SILENT_MIX: WeatherMix = {
  silent: true,
  rainHissGain: 0,
  rainHissHighpassHz: RAIN_HISS_LIGHT_HIGHPASS_HZ,
  rainHissLowpassHz: RAIN_HISS_LIGHT_LOWPASS_HZ,
  rainRoarGain: 0,
  rainRoarLowpassHz: RAIN_ROAR_LIGHT_LOWPASS_HZ,
  dropsGain: 0,
  windGain: 0,
  windBandHz: WIND_CALM_HZ,
  windLowpassHz: WIND_LOWPASS_RAIN_HZ,
  gritGain: 0,
  gritHighpassHz: GRIT_CALM_HZ,
};

/** Decide every layer for `input`; null (weather off or no conditions) is silence. */
export function weatherMix(input: WeatherSoundInput | null): WeatherMix {
  if (input === null) return SILENT_MIX;
  const { rain, snow, sand } = input.amounts;
  if (rain + snow + sand <= WEATHER_SILENT_AMOUNT) return SILENT_MIX;
  const storm = clamp(input.storm, 0, 1);
  const gust = clamp(input.gust, 0, 1);
  const rainI = soundIntensity(rain);
  const snowI = soundIntensity(snow);
  const sandI = soundIntensity(sand);
  const maxI = Math.max(rainI, snowI, sandI);

  const rainHeavy =
    clamp(clamp(rain / WEATHER_AMOUNT_FOR_FULL_SOUND, 0, 1) + storm * RAIN_STORM_HEAVINESS, 0, 1) *
    (rainI > 0 ? 1 : 0);

  const windLevel = clamp(
    rainI * WIND_FROM_RAIN + snowI * WIND_FROM_SNOW + sandI * WIND_FROM_SAND + storm * maxI * WIND_FROM_STORM,
    0,
    1,
  );
  const windWeight = rainI * WIND_FROM_RAIN + snowI * WIND_FROM_SNOW + sandI * WIND_FROM_SAND;
  // The muffling follows whichever kinds carry the wind, blended on a log-frequency scale.
  const windLowpassHz =
    windWeight > 0
      ? Math.exp(
          (rainI * WIND_FROM_RAIN * Math.log(WIND_LOWPASS_RAIN_HZ) +
            snowI * WIND_FROM_SNOW * Math.log(WIND_LOWPASS_SNOW_HZ) +
            sandI * WIND_FROM_SAND * Math.log(WIND_LOWPASS_SAND_HZ)) /
            windWeight,
        )
      : WIND_LOWPASS_RAIN_HZ;

  const mix: Omit<WeatherMix, 'silent'> = {
    rainHissGain: RAIN_HISS_MAX_GAIN * rainI * (1 - (1 - RAIN_HISS_HEAVY_SHARE) * rainHeavy),
    rainHissHighpassHz: lerpHz(RAIN_HISS_LIGHT_HIGHPASS_HZ, RAIN_HISS_HEAVY_HIGHPASS_HZ, rainHeavy),
    rainHissLowpassHz: lerpHz(RAIN_HISS_LIGHT_LOWPASS_HZ, RAIN_HISS_HEAVY_LOWPASS_HZ, rainHeavy),
    rainRoarGain: RAIN_ROAR_MAX_GAIN * rainI * rainHeavy,
    rainRoarLowpassHz: lerpHz(RAIN_ROAR_LIGHT_LOWPASS_HZ, RAIN_ROAR_HEAVY_LOWPASS_HZ, rainHeavy),
    dropsGain: DROPS_MAX_GAIN * rainI * (1 - DROPS_HEAVY_DUCK * rainHeavy),
    windGain: WIND_MAX_GAIN * windLevel * (1 - GUST_SWELL_DEPTH + GUST_SWELL_DEPTH * gust),
    windBandHz: lerpHz(WIND_CALM_HZ, WIND_GUST_HZ, clamp(gust * (1 - storm / 2) + storm / 2, 0, 1)),
    windLowpassHz,
    gritGain: GRIT_MAX_GAIN * sandI * (1 - GRIT_GUST_DEPTH + GRIT_GUST_DEPTH * gust),
    gritHighpassHz: lerpHz(GRIT_CALM_HZ, GRIT_STORM_HZ, storm),
  };
  const loudest = Math.max(mix.rainHissGain, mix.rainRoarGain, mix.dropsGain, mix.windGain, mix.gritGain);
  return { silent: loudest < WEATHER_SILENT_GAIN, ...mix };
}
