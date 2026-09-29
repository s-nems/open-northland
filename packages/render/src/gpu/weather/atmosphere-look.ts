import { stormOf, weatherIntensity } from '../../data/weather/precipitation.js';
import { WEATHER_KINDS, type WeatherAmounts, type WeatherKind } from '../../data/weather/types.js';

/**
 * What the air does to the whole picture for the view's smoothed weather: a light tinted grade, drifting
 * cloud shadows, a thin haze veil with moving mist, a faint storm vignette and the lightning flash. An
 * OpenNorthland enhancement (the original had no tint at all); every constant is tuned by eye within a
 * readability budget: weather is an accent over the game, so the heaviest storm dims the scene by about
 * a tenth and veils it by at most {@link MAX_HAZE_ALPHA}. Mood comes from a cool or warm shift and a
 * grey veil that mutes colour, not from darkness.
 */

type Rgb = readonly [number, number, number];

interface KindAir {
  /** Multiply grade at full intensity, and the extra multiply a full storm adds. */
  readonly grade: Rgb;
  readonly stormGrade: Rgb;
  /** 0..1 darkening under drifting clouds, at full intensity and extra at full storm. */
  readonly cloudShadow: number;
  readonly stormCloudShadow: number;
  /** Haze veil colour, its alpha at full intensity and the extra at full storm (whiteout, dust wall).
   *  A colour near the scene's own mid-tone mutes saturation without darkening or washing it out. */
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
    // Overcast and cool: blue kept, reds and greens lowered a little.
    grade: [0.93, 0.95, 0.99],
    stormGrade: [0.96, 0.97, 0.99],
    cloudShadow: 0.05,
    stormCloudShadow: 0.05,
    haze: [0.5, 0.55, 0.6],
    hazeAlpha: 0.05,
    stormHazeAlpha: 0.07,
    mist: 0.5,
    streaks: 0.15,
  },
  snow: {
    // Flat winter light: nearly no dimming, a cold cast, and a pale blizzard veil.
    grade: [0.96, 0.97, 1],
    stormGrade: [0.98, 0.98, 1],
    cloudShadow: 0.04,
    stormCloudShadow: 0.03,
    haze: [0.84, 0.87, 0.92],
    hazeAlpha: 0.04,
    stormHazeAlpha: 0.1,
    mist: 0.55,
    streaks: 0.5,
  },
  sand: {
    // Warm dust light: blue absorbed, the veil a muted ochre that mutes the greens.
    grade: [1, 0.96, 0.88],
    stormGrade: [0.97, 0.93, 0.87],
    cloudShadow: 0,
    stormCloudShadow: 0.03,
    haze: [0.7, 0.58, 0.42],
    hazeAlpha: 0.06,
    stormHazeAlpha: 0.08,
    mist: 0.6,
    streaks: 0.8,
  },
};

/** Ceiling of the combined mean veil alpha, whatever mix of kinds the view holds. */
export const MAX_HAZE_ALPHA = 0.15;
/** Floor of the grade's luminance when several kinds meet in one view and their grades multiply. */
const MIN_GRADE_LUMINANCE = 0.9;
/** Rec. 709 luma weights. */
const LUMA: Rgb = [0.2126, 0.7152, 0.0722];
/** Vignette corner darkening at a full storm: a faint frame, never a tunnel. */
const STORM_VIGNETTE = 0.08;
/** Additive cool flash colour at full flash, and how much of the grade's dimming a full flash lifts: a
 *  soft cold lift of the sky, low in contrast, never a white wash. */
const FLASH_COLOUR: Rgb = [0.035, 0.045, 0.07];
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
  const gradeLuminance = grade[0] * LUMA[0] + grade[1] * LUMA[1] + grade[2] * LUMA[2];
  const keep = gradeLuminance < MIN_GRADE_LUMINANCE ? (1 - MIN_GRADE_LUMINANCE) / (1 - gradeLuminance) : 1;
  const lift = FLASH_LIFT * flash;
  for (let c = 0; c < grade.length; c++) {
    const dimming = (1 - (grade[c] ?? 1)) * keep;
    grade[c] = 1 - dimming * (1 - lift);
  }
  const hazeAlpha = Math.min(MAX_HAZE_ALPHA, 1 - clear);
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
