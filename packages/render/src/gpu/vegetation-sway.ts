import type { Sprite } from 'pixi.js';
import type { WindSway } from '../data/weather/climate.js';

/** The breeze: a slow swing and its octave, in radians per tick, and a phase per world px so
 *  neighbouring plants never swing in step. */
const BREEZE_RATE = 0.055;
const BREEZE_OCTAVE_RATE = 0.11;
const BREEZE_WEIGHT = 0.75;
const BREEZE_OCTAVE_WEIGHT = 0.25;
const PHASE_PER_X = 0.013;
const PHASE_PER_Y = 0.009;

/** Weather wind, as shares of the plant's own sway at full wind strength, all tuned by eye: how much
 *  wider the breeze swings, the steady lean downwind, and the fast flutter a full gust adds. */
const WIND_SWING_GAIN = 1.5;
const WIND_LEAN = 2.5;
const WIND_GUST_FLUTTER = 1;
/** The gust flutter's rate in radians per tick, and how much faster its phase turns across the map, so
 *  a gust ripples through a wood instead of shaking it in unison. */
const GUST_FLUTTER_RATE = 0.29;
const GUST_FLUTTER_PHASE_SCALE = 2.3;

/**
 * Artistic breeze approximation: a bounded shear around the ground anchor, independent of sim state.
 * Weather `wind` swings it wider, leans it downwind and adds a gust flutter; a positive shear leans the
 * crown left, so the lean takes the wind's sign reversed. No wind, or strength 0, is the plain breeze.
 */
export function vegetationShear(
  tick: number,
  x: number,
  y: number,
  strength: number,
  wind?: WindSway,
): number {
  const phase = x * PHASE_PER_X + y * PHASE_PER_Y;
  const breeze =
    BREEZE_WEIGHT * Math.sin(tick * BREEZE_RATE + phase) +
    BREEZE_OCTAVE_WEIGHT * Math.sin(tick * BREEZE_OCTAVE_RATE + phase);
  if (wind === undefined || wind.strength === 0) return strength * breeze;
  const flutter = Math.sin(tick * GUST_FLUTTER_RATE + phase * GUST_FLUTTER_PHASE_SCALE);
  return (
    strength *
    (breeze * (1 + WIND_SWING_GAIN * wind.strength) -
      wind.direction * WIND_LEAN * wind.strength +
      wind.gust * WIND_GUST_FLUTTER * flutter)
  );
}

/** Approximation: how many times flatter than its caster a silhouette may be and still read as that
 *  caster's projection. A flatter one lies under the body, and the shear it would need sweeps its rows
 *  across the ground. The original's still trees cast at about one sixth of their height. */
const MAX_SHADOW_FLATTENING = 8;

/**
 * The shear that carries a ground silhouette's far edge as far as its caster's top travels. `bodyTop`
 * and `shadowTop` are the two frames' `offsetY`, negative above the feet. Approximation: it reads the
 * authored silhouette as the body flattened onto the ground, so height along the body maps linearly to
 * depth along the shadow. The shear pivots at the feet, so rows a silhouette paints below them drift the
 * other way, and a silhouette that reaches no further than the feet stays put.
 */
export function castShadowShear(bodyShear: number, bodyTop: number, shadowTop: number): number {
  if (shadowTop >= 0) return 0;
  return bodyShear * Math.min(bodyTop / shadowTop, MAX_SHADOW_FLATTENING);
}

export function setVegetationShear(sprite: Sprite, scale: number, shear: number): void {
  sprite.skew.x = Math.atan(shear);
  sprite.scale.set(scale, scale * Math.hypot(1, shear));
}
