import { stormOf, weatherIntensity } from '../../data/weather/precipitation.js';
import { WEATHER_KINDS, type WeatherAmounts, type WeatherKind } from '../../data/weather/types.js';

/**
 * What the air does to the whole picture for the view's smoothed weather: a multiply grade, drifting
 * cloud shadows, a haze veil with moving mist, a storm vignette and the lightning flash. An
 * OpenNorthland enhancement (the original had no tint at all); every constant is tuned by eye.
 */

type Rgb = readonly [number, number, number];

interface KindAir {
  /** Multiply grade at full intensity, and the extra multiply a full storm adds. */
  readonly grade: Rgb;
  readonly stormGrade: Rgb;
  /** 0..1 darkening under drifting clouds, at full intensity and extra at full storm. */
  readonly cloudShadow: number;
  readonly stormCloudShadow: number;
  /** Haze veil colour, its alpha at full intensity and the extra at full storm (whiteout, dust wall). */
  readonly haze: Rgb;
  readonly hazeAlpha: number;
  readonly stormHazeAlpha: number;
  /** How unevenly the mist lies, 0 flat .. 1 in banks. */
  readonly mist: number;
  /** 0..1 share of the mist that blows in long streaks at a full storm: drifting snow, a dust wall. */
  readonly streaks: number;
}

const AIR: Readonly<Record<WeatherKind, KindAir>> = {
  rain: {
    grade: [0.8, 0.85, 0.92],
    stormGrade: [0.66, 0.7, 0.8],
    cloudShadow: 0.16,
    stormCloudShadow: 0.18,
    haze: [0.58, 0.64, 0.72],
    hazeAlpha: 0.1,
    stormHazeAlpha: 0.16,
    mist: 0.55,
    streaks: 0.15,
  },
  snow: {
    // Overcast: the ground dims a little so the white flakes stand out against snow cover.
    grade: [0.83, 0.86, 0.93],
    stormGrade: [0.92, 0.94, 0.98],
    cloudShadow: 0.08,
    stormCloudShadow: 0.06,
    haze: [0.9, 0.93, 0.98],
    hazeAlpha: 0.06,
    stormHazeAlpha: 0.34,
    mist: 0.65,
    streaks: 0.5,
  },
  sand: {
    grade: [1, 0.93, 0.8],
    stormGrade: [0.9, 0.8, 0.66],
    cloudShadow: 0,
    stormCloudShadow: 0.05,
    haze: [0.84, 0.66, 0.44],
    hazeAlpha: 0.14,
    stormHazeAlpha: 0.3,
    mist: 0.75,
    streaks: 0.85,
  },
};

/** Vignette corner darkening at a full storm. */
const STORM_VIGNETTE = 0.38;
/** Additive cool flash colour at full flash, and how much of the grade's darkening a full flash lifts:
 *  a strike lights the scene up to about its clear-day look with a cold edge, never a white wash. */
const FLASH_COLOUR: Rgb = [0.09, 0.11, 0.18];
const FLASH_LIFT = 0.75;
/** Below this the air is left undrawn. */
const VISIBLE_EPSILON = 0.002;

export interface AtmosphereLook {
  readonly visible: boolean;
  readonly grade: Rgb;
  readonly cloudShadow: number;
  readonly vignette: number;
  readonly haze: Rgb;
  readonly hazeAlpha: number;
  readonly mist: number;
  readonly streaks: number;
  readonly flash: Rgb;
}

export function atmosphereLook(amounts: WeatherAmounts, flash: number): AtmosphereLook {
  const grade: [number, number, number] = [1, 1, 1];
  const haze: [number, number, number] = [0, 0, 0];
  let clear = 1;
  let hazeWeight = 0;
  let cloudShadow = 0;
  let storm = 0;
  let mist = 0;
  let streaks = 0;
  let strongest = 0;
  for (const kind of WEATHER_KINDS) {
    const intensity = weatherIntensity(kind, amounts[kind]);
    if (intensity <= 0) continue;
    const kindStorm = stormOf(kind, amounts[kind]);
    const air = AIR[kind];
    for (let c = 0; c < grade.length; c++) {
      const full = (air.grade[c] ?? 1) * (1 + ((air.stormGrade[c] ?? 1) - 1) * kindStorm);
      grade[c] = (grade[c] ?? 1) * (1 + (full - 1) * intensity);
    }
    const alpha = air.hazeAlpha * intensity + air.stormHazeAlpha * kindStorm;
    clear *= 1 - alpha;
    for (let c = 0; c < haze.length; c++) haze[c] = (haze[c] ?? 0) + (air.haze[c] ?? 0) * alpha;
    hazeWeight += alpha;
    cloudShadow = Math.max(cloudShadow, air.cloudShadow * intensity + air.stormCloudShadow * kindStorm);
    storm = Math.max(storm, kindStorm);
    mist += air.mist * alpha;
    streaks = Math.max(streaks, air.streaks * kindStorm);
    strongest = Math.max(strongest, intensity);
  }
  for (let c = 0; c < grade.length; c++)
    grade[c] = (grade[c] ?? 1) + (1 - (grade[c] ?? 1)) * FLASH_LIFT * flash;
  const hazeAlpha = 1 - clear;
  const norm = hazeWeight > 0 ? 1 / hazeWeight : 0;
  return {
    visible: strongest > VISIBLE_EPSILON || flash > 0,
    grade,
    cloudShadow,
    vignette: STORM_VIGNETTE * storm,
    haze: [haze[0] * norm, haze[1] * norm, haze[2] * norm],
    hazeAlpha,
    mist: mist * norm,
    streaks,
    flash: [FLASH_COLOUR[0] * flash, FLASH_COLOUR[1] * flash, FLASH_COLOUR[2] * flash],
  };
}
