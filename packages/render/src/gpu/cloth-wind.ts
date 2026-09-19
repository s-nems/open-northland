/**
 * Artistic approximation, independent of sim state: wind in a ship's set sail. The original draws one
 * rigid frame per heading, so the paletted shader ripples the sail's own pixels instead: a travelling
 * wave slides the stripes sideways inside the sail's fixed outline and lights its crests, harder under
 * way than standing at sea. Periods are sim ticks (12 Hz), lengths native sprite pixels.
 */

/** Two inclusive palette-index ranges `[loA, hiA, loB, hiB]` that are cloth in an indexed atlas. */
export type ClothIndexRanges = readonly [number, number, number, number];

/** One frame's wind through a paletted sprite's cloth pixels. */
export interface ClothWind {
  readonly ranges: ClothIndexRanges;
  /** The wave's phase, radians. */
  readonly phase: number;
  /** How far the weave slides sideways at a crest. */
  readonly displacementPx: number;
  /** The crest-to-mean brightness swing, as a fraction of the colour. */
  readonly shadeDepth: number;
  /** Radians per pixel along x and y: the wave runs down and across the sail. */
  readonly freqX: number;
  readonly freqY: number;
}

const WAVE_PERIOD_TICKS = 14;
const WAVELENGTH_X_PX = 46;
const WAVELENGTH_Y_PX = 64;
const SAILING_DISPLACEMENT_PX = 2;
const SAILING_SHADE_DEPTH = 0.1;
const AT_SEA_DISPLACEMENT_PX = 1;
const AT_SEA_SHADE_DEPTH = 0.05;
/** Per-anchor phase offsets, radians per world pixel, so a fleet's sails never ripple in step. */
const PHASE_PER_X = 0.021;
const PHASE_PER_Y = 0.017;
const TAU = Math.PI * 2;

export function sailWind(
  ranges: ClothIndexRanges,
  tick: number,
  x: number,
  y: number,
  underSail: boolean,
): ClothWind {
  return {
    ranges,
    phase: ((tick / WAVE_PERIOD_TICKS) * TAU + x * PHASE_PER_X + y * PHASE_PER_Y) % TAU,
    displacementPx: underSail ? SAILING_DISPLACEMENT_PX : AT_SEA_DISPLACEMENT_PX,
    shadeDepth: underSail ? SAILING_SHADE_DEPTH : AT_SEA_SHADE_DEPTH,
    freqX: TAU / WAVELENGTH_X_PX,
    freqY: TAU / WAVELENGTH_Y_PX,
  };
}
