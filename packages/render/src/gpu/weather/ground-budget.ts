import type { WeatherField } from '../../data/weather/field.js';
import { weatherAmountAt } from '../../data/weather/field.js';
import { WEATHER_KINDS, type WeatherConditions, type WeatherKind } from '../../data/weather/types.js';

/**
 * How many ground reactions the screen shows: rain splashes on land, rings on water, snow and sand
 * wisps. Each group owns a fixed slot range in one static mesh; the budget says how many of its slots
 * run this frame. Counts follow the screen's area in CSS px, never the map, and each group is capped
 * by its slot range. Densities are tuned by eye.
 */

export const SPLASH_SLOTS = 1536;
export const RIPPLE_SLOTS = 512;
export const WISP_SLOTS = 384;

/** Screen px² per running slot at full activity, before the storm boost. */
const SPLASH_SCREEN_PX2 = 2400;
const RIPPLE_SCREEN_PX2 = 3200;
const WISP_SCREEN_PX2 = 8000;
/** A full storm runs this many times the calm count. */
const STORM_BOOST = 1.6;
/** Wisps run at this share of their count in still air and ramp to all of it at this wind speed. */
const WISP_CALM_SHARE = 0.25;
const WISP_FULL_WIND_PX_PER_S = 60;
/** A screen amount below this counts as no weather at all. */
const ACTIVE_AMOUNT = 1e-3;

export type WeatherActivity = Readonly<Record<WeatherKind, number>>;

/**
 * Whether each kind is falling now, 0..1: the screen's smoothed amount over the field's own amount at
 * the screen centre. The field alone says where weather lives; this ratio lets a sky that varies it
 * over time (a shower passing, a squall easing) start and stop the ground reactions with it.
 */
export function weatherActivity(
  conditions: WeatherConditions,
  field: WeatherField,
  centreHx: number,
  centreHy: number,
): WeatherActivity {
  const activity: Record<WeatherKind, number> = { rain: 0, snow: 0, sand: 0 };
  for (const kind of WEATHER_KINDS) {
    const amount = conditions.amounts[kind];
    if (amount < ACTIVE_AMOUNT) continue;
    const local = weatherAmountAt(field, kind, centreHx, centreHy);
    activity[kind] = local < ACTIVE_AMOUNT ? 1 : Math.min(1, amount / local);
  }
  return activity;
}

export interface GroundBudget {
  readonly splashes: number;
  readonly ripples: number;
  readonly wisps: number;
}

export const NO_GROUND_BUDGET: GroundBudget = { splashes: 0, ripples: 0, wisps: 0 };

/** The running slot counts for a `screenW` by `screenH` CSS px view. */
export function groundBudget(
  screenW: number,
  screenH: number,
  activity: WeatherActivity,
  conditions: Pick<WeatherConditions, 'storm' | 'windX' | 'windY' | 'gust'>,
): GroundBudget {
  const area = Math.max(0, screenW) * Math.max(0, screenH);
  const storm = 1 + STORM_BOOST * Math.min(1, Math.max(0, conditions.storm));
  const wind = Math.min(1, Math.hypot(conditions.windX, conditions.windY) / WISP_FULL_WIND_PX_PER_S);
  const airborne = Math.max(activity.snow, activity.sand);
  const windShare = Math.min(1, WISP_CALM_SHARE + (1 - WISP_CALM_SHARE) * Math.max(wind, conditions.gust));
  const count = (px2: number, scale: number, cap: number): number =>
    scale <= 0 ? 0 : Math.min(cap, Math.round((area / px2) * scale));
  return {
    splashes: count(SPLASH_SCREEN_PX2, activity.rain * storm, SPLASH_SLOTS),
    ripples: count(RIPPLE_SCREEN_PX2, activity.rain * storm, RIPPLE_SLOTS),
    wisps: count(WISP_SCREEN_PX2, airborne * storm * windShare, WISP_SLOTS),
  };
}
