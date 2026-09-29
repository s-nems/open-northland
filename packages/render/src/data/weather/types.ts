/** The original's three precipitation kinds. Weather is presentation only: the sim never reads it. */
export type WeatherKind = 'rain' | 'snow' | 'sand';

export const WEATHER_KINDS: readonly WeatherKind[] = ['rain', 'snow', 'sand'];

/** Densities are the original's 0..10000 scale; `SetWeather` writes `amount * 100`. */
export const WEATHER_DENSITY_FULL = 10_000;

/** One written rectangle in half-cell nodes, inclusive. Later writes win where rectangles overlap. */
export interface WeatherRegionInput {
  readonly weather: WeatherKind;
  readonly min: { readonly hx: number; readonly hy: number };
  readonly max: { readonly hx: number; readonly hy: number };
  readonly density: number;
}

/** Normalised 0..1 amounts per kind. */
export type WeatherAmounts = Readonly<Record<WeatherKind, number>>;

/** A lightning strike, keyed so a consumer plays each strike once. */
export interface LightningStrike {
  readonly id: number;
  /** Game seconds when the flash starts. */
  readonly atSeconds: number;
  /** Screen fraction 0..1 of the bolt's ground point; may lie off screen for a distant strike. */
  readonly screenX: number;
  readonly screenY: number;
  /** 0 overhead .. 1 far away: dims the flash, delays and muffles the thunder. */
  readonly distance: number;
}

/**
 * What the view is experiencing this frame, the single input for sky, ground and audio consumers.
 * Advanced by game seconds, so pause freezes it and replays repeat it.
 */
export interface WeatherConditions {
  /** Smoothed amounts over the visible screen. */
  readonly amounts: WeatherAmounts;
  /** 0 calm .. 1 full storm: rain storm, blizzard or sandstorm. */
  readonly storm: number;
  /** Wind in screen px per game second; positive x blows right, positive y blows down the screen. */
  readonly windX: number;
  readonly windY: number;
  /** 0..1 gust strength on top of the steady wind, for sway, whistling and swirl. */
  readonly gust: number;
  /** 0..1 current lightning flash brightness. */
  readonly flash: number;
  /** Strikes still relevant this frame, newest last (flash in progress or thunder still to arrive). */
  readonly strikes: readonly LightningStrike[];
}
