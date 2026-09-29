import { frac } from '../effects/blood.js';
import type { WeatherField } from './field.js';
import { smoothstep } from './precipitation.js';
import { WEATHER_KINDS, type WeatherKind } from './types.js';

/**
 * The game's own weather, laid where a map authors none. An OpenNorthland addition (the original shows
 * weather only where a map asks for it); every constant is a tuned approximation. Both schedules are
 * pure functions of the match seed and game seconds, so a pause freezes them, and a save, a replay
 * and every seat of a shared game see the same weather.
 */

const MINUTE = 60;
interface Range {
  readonly min: number;
  readonly max: number;
}

/** A weather level: 0 clear, up to 1 light, up to 2 heavy, up to 3 a full storm. */
export const AMBIENT_LIGHT_LEVEL = 1;
export const AMBIENT_HEAVY_LEVEL = 2;
export const AMBIENT_STORM_LEVEL = 3;

/** The field amount of each kind at the light, heavy and storm levels. Light stays well under the
 *  amount where the kind's storm begins, heavy reaches it, storm is most of a full one. */
export const AMBIENT_LEVEL_AMOUNTS: Readonly<Record<WeatherKind, readonly [number, number, number]>> = {
  rain: [0.1, 0.18, 0.3],
  snow: [0.12, 0.25, 0.42],
  sand: [0.035, 0.045, 0.07],
};

/** The amount of `kind` at a weather `level`, linear between the levels' amounts. */
export function ambientAmount(kind: WeatherKind, level: number): number {
  const points = [0, ...AMBIENT_LEVEL_AMOUNTS[kind]];
  const clamped = Math.min(AMBIENT_STORM_LEVEL, Math.max(0, level));
  const below = Math.min(AMBIENT_STORM_LEVEL - 1, Math.floor(clamped));
  const low = points[below] ?? 0;
  return low + ((points[below + 1] ?? low) - low) * (clamped - below);
}

/** Game seconds before the first episode may start, tuned for play at triple speed. */
const FIRST_DELAY_SECONDS: Range = { min: 25 * MINUTE, max: 120 * MINUTE };
/** Clear game seconds between two episodes. */
const GAP_SECONDS: Range = { min: 60 * MINUTE, max: 180 * MINUTE };
const EPISODE_SECONDS: Range = { min: 6 * MINUTE, max: 14 * MINUTE };
/** An episode fades in and out over this long at each end. */
const EPISODE_RAMP_SECONDS = 90;
/** Share of episodes that stay clear, so the rhythm cannot be learnt. */
const CLEAR_EPISODE_CHANCE = 0.3;
/** Of the episodes that fall, the share that turn heavy and the share that turn into a storm. */
const HEAVY_EPISODE_CHANCE = 0.2;
const STORM_EPISODE_CHANCE = 0.08;
/** An episode peaks this far into its grade's level band. */
const EPISODE_PEAK_SHARE: Range = { min: 0.45, max: 1 };
/** Share of episodes that turn cold: snow falls where rain would. */
const COLD_EPISODE_CHANCE = 0.12;

/** A map's amount up to this is a trace: it stays, and the game's own weather falls over it. */
export const AUTHORED_TRACE_AMOUNT = 0.01;

/** A sector no weather falls on. */
export const AMBIENT_NO_WEATHER = 0xff;

const SALT_EPISODES = 0x5ca1ab1e;
const SALT_WINTER = 0x51eeb0a7;
const DRAWS_PER_EPISODE = 6;
const DRAW_GAP = 0;
const DRAW_LENGTH = 1;
const DRAW_PEAK = 2;
const DRAW_CLEAR = 3;
const DRAW_GRADE = 4;
const DRAW_COLD = 5;
/** A game far longer than any real one ends the schedule walk. */
const MAX_EPISODES = 512;

const within = (range: Range, share: number): number => range.min + (range.max - range.min) * share;

/** What falls at one moment: how hard, and whether snow takes the place of rain. */
export interface AmbientWeatherNow {
  readonly level: number;
  readonly cold: boolean;
}

const CLEAR: AmbientWeatherNow = { level: 0, cold: false };

/** The variable weather at `gameSeconds` of the match seeded `seed`: rare episodes, mostly light. */
export function variableWeather(seed: number, gameSeconds: number): AmbientWeatherNow {
  const draw = (episode: number, k: number): number =>
    frac(seed ^ SALT_EPISODES, episode * DRAWS_PER_EPISODE + k);
  let start = 0;
  for (let episode = 0; episode < MAX_EPISODES; episode++) {
    start += within(episode === 0 ? FIRST_DELAY_SECONDS : GAP_SECONDS, draw(episode, DRAW_GAP));
    if (gameSeconds < start) return CLEAR;
    const end = start + within(EPISODE_SECONDS, draw(episode, DRAW_LENGTH));
    if (gameSeconds < end) {
      if (draw(episode, DRAW_CLEAR) < CLEAR_EPISODE_CHANCE) return CLEAR;
      const grade = draw(episode, DRAW_GRADE);
      const band =
        grade < STORM_EPISODE_CHANCE
          ? AMBIENT_HEAVY_LEVEL
          : grade < STORM_EPISODE_CHANCE + HEAVY_EPISODE_CHANCE
            ? AMBIENT_LIGHT_LEVEL
            : 0;
      const fade =
        smoothstep(start, start + EPISODE_RAMP_SECONDS, gameSeconds) *
        (1 - smoothstep(end - EPISODE_RAMP_SECONDS, end, gameSeconds));
      const peak = band + within(EPISODE_PEAK_SHARE, draw(episode, DRAW_PEAK));
      return { level: fade * peak, cold: draw(episode, DRAW_COLD) < COLD_EPISODE_CHANCE };
    }
    start = end;
  }
  return CLEAR;
}

/** Winter snowfall drifts between drawn values, one per this many game seconds. */
const WINTER_DRIFT_SECONDS = 12 * MINUTE;
/** A winter draw to a snowfall level: a share of clear breaks, mostly light snow, some heavy, and
 *  a rare blizzard. Each row is the draw it starts at and the level there; linear between rows. */
const WINTER_LEVELS: readonly (readonly [draw: number, level: number])[] = [
  [0, 0],
  [0.12, 0],
  [0.2, 0.35],
  [0.72, AMBIENT_LIGHT_LEVEL],
  [0.93, AMBIENT_HEAVY_LEVEL],
  [1, AMBIENT_STORM_LEVEL],
];
/** The lying snow of a winter game, as ground cover 0..1. */
export const WINTER_LYING_SNOW = 1;

function winterLevelOf(draw: number): number {
  for (let i = 1; i < WINTER_LEVELS.length; i++) {
    const [d0, l0] = WINTER_LEVELS[i - 1] ?? [0, 0];
    const [d1, l1] = WINTER_LEVELS[i] ?? [1, 0];
    if (draw <= d1) return l0 + ((l1 - l0) * (draw - d0)) / (d1 - d0);
  }
  return AMBIENT_STORM_LEVEL;
}

/** The winter snowfall at `gameSeconds`: it never stops for long and changes over minutes. */
export function winterWeather(seed: number, gameSeconds: number): AmbientWeatherNow {
  const position = Math.max(0, gameSeconds) / WINTER_DRIFT_SECONDS;
  const bucket = Math.floor(position);
  const from = winterLevelOf(frac(seed ^ SALT_WINTER, bucket));
  const to = winterLevelOf(frac(seed ^ SALT_WINTER, bucket + 1));
  return { level: from + (to - from) * smoothstep(0, 1, position - bucket), cold: true };
}

/** Which kind falls on each weather sector, row-major: an index into `WEATHER_KINDS` or
 *  {@link AMBIENT_NO_WEATHER}. */
export interface AmbientSectors {
  readonly sectorsX: number;
  readonly sectorsY: number;
  readonly kinds: Uint8Array;
}

const RAIN = WEATHER_KINDS.indexOf('rain');
const SNOW = WEATHER_KINDS.indexOf('snow');

/**
 * The field of the game's own weather: each sector carries its kind's amount at `now.level`, snow
 * for rain when cold. `winter` snows on every sector and keeps the ground white. Where `authored`
 * carries more than a trace of its own in a sector, that sector stays as authored.
 */
export function buildAmbientField(
  sectors: AmbientSectors,
  now: AmbientWeatherNow,
  winter = false,
  authored: WeatherField | null = null,
): WeatherField {
  const kindCount = WEATHER_KINDS.length;
  const amounts = new Float32Array(sectors.sectorsX * sectors.sectorsY * kindCount);
  const sameGrid =
    authored !== null && authored.sectorsX === sectors.sectorsX && authored.sectorsY === sectors.sectorsY;
  let any = false;
  for (let i = 0; i < sectors.kinds.length; i++) {
    const base = i * kindCount;
    let kept = false;
    if (sameGrid && authored !== null) {
      for (let k = 0; k < kindCount; k++) {
        const amount = authored.amounts[base + k] ?? 0;
        amounts[base + k] = amount;
        kept ||= amount > AUTHORED_TRACE_AMOUNT;
        any ||= amount > 0;
      }
    }
    if (kept) {
      any = true;
      continue;
    }
    const own = sectors.kinds[i] ?? AMBIENT_NO_WEATHER;
    const index = winter ? SNOW : own === RAIN && now.cold ? SNOW : own;
    const kind = WEATHER_KINDS[index];
    if (kind === undefined || now.level <= 0) continue;
    amounts[base + index] = Math.max(amounts[base + index] ?? 0, ambientAmount(kind, now.level));
    any = true;
  }
  const field = { sectorsX: sectors.sectorsX, sectorsY: sectors.sectorsY, amounts, any };
  return winter ? { ...field, lyingSnow: WINTER_LYING_SNOW } : field;
}
