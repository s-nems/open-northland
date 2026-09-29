import { frac } from '../effects/blood.js';
import type { WeatherField } from './field.js';
import { smoothstep } from './precipitation.js';
import { WEATHER_KINDS, type WeatherKind } from './types.js';

/**
 * Weather for a map that authors none: rare, light episodes. An OpenNorthland addition (the original
 * shows weather only where a map asks for it); every constant is a tuned approximation. The schedule
 * is a pure function of the match seed and game seconds, so a pause freezes it, and a save, a replay
 * and every seat of a shared game see the same weather.
 */

const MINUTE = 60;
interface Range {
  readonly min: number;
  readonly max: number;
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
/** An episode peaks at a drawn share of {@link AMBIENT_FULL_AMOUNT}. */
const EPISODE_PEAK_SHARE: Range = { min: 0.45, max: 1 };

/** The strongest ambient amount per kind: each stays under the amount where its storm begins. */
export const AMBIENT_FULL_AMOUNT: Readonly<Record<WeatherKind, number>> = {
  rain: 0.1,
  snow: 0.12,
  sand: 0.035,
};

/** A sector no weather falls on: open water or a map without ground data. */
export const AMBIENT_NO_WEATHER = 0xff;

const SALT_AMBIENT = 0x5ca1ab1e;
const DRAWS_PER_EPISODE = 4;
const DRAW_GAP = 0;
const DRAW_LENGTH = 1;
const DRAW_PEAK = 2;
const DRAW_CLEAR = 3;
/** A game far longer than any real one ends the schedule walk. */
const MAX_EPISODES = 512;

const within = (range: Range, share: number): number => range.min + (range.max - range.min) * share;

/** 0..1 share of {@link AMBIENT_FULL_AMOUNT} falling at `gameSeconds` of the match seeded `seed`. */
export function ambientStrength(seed: number, gameSeconds: number): number {
  const draw = (episode: number, k: number): number =>
    frac(seed ^ SALT_AMBIENT, episode * DRAWS_PER_EPISODE + k);
  let start = 0;
  for (let episode = 0; episode < MAX_EPISODES; episode++) {
    start += within(episode === 0 ? FIRST_DELAY_SECONDS : GAP_SECONDS, draw(episode, DRAW_GAP));
    if (gameSeconds < start) return 0;
    const end = start + within(EPISODE_SECONDS, draw(episode, DRAW_LENGTH));
    if (gameSeconds < end) {
      if (draw(episode, DRAW_CLEAR) < CLEAR_EPISODE_CHANCE) return 0;
      const fade =
        smoothstep(start, start + EPISODE_RAMP_SECONDS, gameSeconds) *
        (1 - smoothstep(end - EPISODE_RAMP_SECONDS, end, gameSeconds));
      return fade * within(EPISODE_PEAK_SHARE, draw(episode, DRAW_PEAK));
    }
    start = end;
  }
  return 0;
}

/** Which kind falls on each weather sector, row-major: an index into `WEATHER_KINDS` or
 *  {@link AMBIENT_NO_WEATHER}. */
export interface AmbientSectors {
  readonly sectorsX: number;
  readonly sectorsY: number;
  readonly kinds: Uint8Array;
}

/** The field of an ambient episode at `strength`: each sector carries its own kind's amount. */
export function buildAmbientField(sectors: AmbientSectors, strength: number): WeatherField {
  const kindCount = WEATHER_KINDS.length;
  const amounts = new Float32Array(sectors.sectorsX * sectors.sectorsY * kindCount);
  let any = false;
  if (strength > 0) {
    for (let i = 0; i < sectors.kinds.length; i++) {
      const kind = WEATHER_KINDS[sectors.kinds[i] ?? AMBIENT_NO_WEATHER];
      if (kind === undefined) continue;
      amounts[i * kindCount + WEATHER_KINDS.indexOf(kind)] = AMBIENT_FULL_AMOUNT[kind] * strength;
      any = true;
    }
  }
  return { sectorsX: sectors.sectorsX, sectorsY: sectors.sectorsY, amounts, any };
}
