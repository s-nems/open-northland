import type { WeatherConditions } from '@open-northland/render/data';
import { clamp, lerpHz } from '../math.js';

/**
 * The weather soundscape's decision: what each synthesized layer should sound like for the conditions
 * on screen. The original plays no weather sound at all, so every level, band and curve here is an
 * approximation tuned by reasoning about real rain, wind and sand, not by ear against a reference.
 */

/** The part of the render's weather conditions the soundscape reads. */
export type WeatherSoundInput = Pick<WeatherConditions, 'amounts' | 'storm' | 'gust' | 'strikes'>;

/** Target levels and filter settings for every continuous layer; gains are linear amplitude. */
export interface WeatherMix {
  /** True when every layer is silent: playback may tear its graph down. */
  readonly silent: boolean;
  /** Broadband rain hiss and the high-pass that sets how bright it is. */
  readonly rainHissGain: number;
  readonly rainHissHighpassHz: number;
  /** Low rain body (the roar of heavy rain) and its low-pass. */
  readonly rainBodyGain: number;
  readonly rainBodyLowpassHz: number;
  /** Droplet patter: a sparse texture for light rain crossfading into a dense one for heavy rain. */
  readonly patterSparseGain: number;
  readonly patterDenseGain: number;
  /** Band-passed wind noise, then a low-pass that muffles it (snow) or opens it (sand). */
  readonly windGain: number;
  readonly windBandHz: number;
  readonly windLowpassHz: number;
  /** Narrow whistling resonances over storm wind. */
  readonly whistleGain: number;
  readonly whistleHz: number;
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
export const WEATHER_SILENT_GAIN = 1e-3;

/** Layer ceilings, linear amplitude into the game-sounds bus. Approximations, balanced so a full
 *  storm sits under the settlers' work sounds rather than masking them. */
export const RAIN_HISS_MAX_GAIN = 0.2;
export const RAIN_BODY_MAX_GAIN = 0.32;
export const PATTER_MAX_GAIN = 0.4;
export const WIND_MAX_GAIN = 0.4;
export const WHISTLE_MAX_GAIN = 0.1;
export const GRIT_MAX_GAIN = 0.16;

/** Rain hiss high-pass: bright for a drizzle, opening down for a downpour. Approximation. */
export const RAIN_HISS_LIGHT_HZ = 3200;
export const RAIN_HISS_HEAVY_HZ = 1100;
/** Rain body low-pass: heavier rain rumbles lower. Approximation. */
export const RAIN_BODY_LIGHT_HZ = 1000;
export const RAIN_BODY_HEAVY_HZ = 380;
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
export const WIND_CALM_HZ = 260;
export const WIND_GUST_HZ = 780;
/** Wind muffling low-pass per kind: snow is soft and dull, rain in between, sand harsh. */
export const WIND_LOWPASS_SNOW_HZ = 700;
export const WIND_LOWPASS_RAIN_HZ = 2200;
export const WIND_LOWPASS_SAND_HZ = 7000;

/** Storm value where the whistle starts, reaching full at a full storm. Approximation. */
export const WHISTLE_STORM_FROM = 0.45;
/** Whistle pitch from a lull to the top of a gust. Approximation. */
export const WHISTLE_LOW_HZ = 620;
export const WHISTLE_HIGH_HZ = 1350;
/** Share of the whistle level that needs a gust to sound. */
export const WHISTLE_GUST_DEPTH = 0.7;

/** Sand grit high-pass, lowering (coarser) in a sandstorm. Approximation. */
export const GRIT_CALM_HZ = 3400;
export const GRIT_STORM_HZ = 2200;
/** Share of the grit level that swells with the gust. */
export const GRIT_GUST_DEPTH = 0.5;

/** Perceived intensity 0..1 of an amount: a square-root curve so thin weather is still audible. */
export function soundIntensity(amount: number): number {
  return Math.sqrt(clamp(amount / WEATHER_AMOUNT_FOR_FULL_SOUND, 0, 1));
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

const SILENT_MIX: WeatherMix = {
  silent: true,
  rainHissGain: 0,
  rainHissHighpassHz: RAIN_HISS_LIGHT_HZ,
  rainBodyGain: 0,
  rainBodyLowpassHz: RAIN_BODY_LIGHT_HZ,
  patterSparseGain: 0,
  patterDenseGain: 0,
  windGain: 0,
  windBandHz: WIND_CALM_HZ,
  windLowpassHz: WIND_LOWPASS_RAIN_HZ,
  whistleGain: 0,
  whistleHz: WHISTLE_LOW_HZ,
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
    rainHissGain: RAIN_HISS_MAX_GAIN * rainI,
    rainHissHighpassHz: lerpHz(RAIN_HISS_LIGHT_HZ, RAIN_HISS_HEAVY_HZ, rainHeavy),
    rainBodyGain: RAIN_BODY_MAX_GAIN * rainI * rainHeavy,
    rainBodyLowpassHz: lerpHz(RAIN_BODY_LIGHT_HZ, RAIN_BODY_HEAVY_HZ, rainHeavy),
    patterSparseGain: PATTER_MAX_GAIN * rainI * (1 - rainHeavy),
    patterDenseGain: PATTER_MAX_GAIN * rainI * rainHeavy,
    windGain: WIND_MAX_GAIN * windLevel * (1 - GUST_SWELL_DEPTH + GUST_SWELL_DEPTH * gust),
    windBandHz: lerpHz(WIND_CALM_HZ, WIND_GUST_HZ, clamp(gust * (1 - storm / 2) + storm / 2, 0, 1)),
    windLowpassHz,
    whistleGain:
      WHISTLE_MAX_GAIN *
      maxI *
      smoothstep(WHISTLE_STORM_FROM, 1, storm) *
      (1 - WHISTLE_GUST_DEPTH + WHISTLE_GUST_DEPTH * gust),
    whistleHz: lerpHz(WHISTLE_LOW_HZ, WHISTLE_HIGH_HZ, gust),
    gritGain: GRIT_MAX_GAIN * sandI * (1 - GRIT_GUST_DEPTH + GRIT_GUST_DEPTH * gust),
    gritHighpassHz: lerpHz(GRIT_CALM_HZ, GRIT_STORM_HZ, storm),
  };
  const loudest = Math.max(
    mix.rainHissGain,
    mix.rainBodyGain,
    mix.patterSparseGain,
    mix.patterDenseGain,
    mix.windGain,
    mix.whistleGain,
    mix.gritGain,
  );
  return { silent: loudest < WEATHER_SILENT_GAIN, ...mix };
}
