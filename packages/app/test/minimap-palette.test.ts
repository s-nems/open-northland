import { describe, expect, it } from 'vitest';
import { PLAYER_SWATCH_COLORS } from '../src/catalog/roster.js';
import { ANIMAL_DOT_COLOUR, ROAD_SITE_DOT_COLOUR } from '../src/hud/minimap/dots.js';
import {
  contrastRatio,
  MARKER_RIM_COLOUR,
  MIN_RIM_CONTRAST,
  MINIMAP_PLAYER_COLOURS,
  minimapPlayerColour,
  STANCE_COLOURS,
  STANCE_SELF_COLOUR,
} from '../src/hud/minimap/palette.js';
import { ROAD_DOT_COLOUR } from '../src/hud/minimap/road-layer.js';

/** The lift's own floor, well over the 3:1 WCAG floor for non-text graphics. */
const MIN_CONTRAST = MIN_RIM_CONTRAST;
/** A CIE76 colour difference well past "just noticeable", so a fill never passes for a fauna or road dot. */
const MIN_DELTA_E = 15;
/** Rounding to 8-bit channels moves the hue of a saturated fill by a degree or so. */
const HUE_TOLERANCE_DEGREES = 3;
const GREYISH_CHROMA = 0.1;

const channels = (colour: number): [number, number, number] => [
  ((colour >> 16) & 0xff) / 0xff,
  ((colour >> 8) & 0xff) / 0xff,
  (colour & 0xff) / 0xff,
];

function hueOf(colour: number): number {
  const [r, g, b] = channels(colour);
  const max = Math.max(r, g, b);
  const chroma = max - Math.min(r, g, b);
  const sector =
    max === r ? ((g - b) / chroma + 6) % 6 : max === g ? (b - r) / chroma + 2 : (r - g) / chroma + 4;
  return sector * 60;
}

function chromaOf(colour: number): number {
  const [r, g, b] = channels(colour);
  return Math.max(r, g, b) - Math.min(r, g, b);
}

/** sRGB to CIE L*a*b* under D65. */
function lab(colour: number): [number, number, number] {
  const [r, g, b] = channels(colour).map((c) =>
    c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  ) as [number, number, number];
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number): number => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 / 116) * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

function deltaE(a: number, b: number): number {
  const [l1, a1, b1] = lab(a);
  const [l2, a2, b2] = lab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

const hex = (colour: number): string => `#${colour.toString(16).padStart(6, '0')}`;

describe('minimap palette', () => {
  const fills = [...MINIMAP_PLAYER_COLOURS, STANCE_SELF_COLOUR, ...Object.values(STANCE_COLOURS)];

  it('keeps every marker fill at the lift floor against the dark rim', () => {
    for (const fill of fills)
      expect(contrastRatio(fill, MARKER_RIM_COLOUR), hex(fill)).toBeGreaterThanOrEqual(MIN_CONTRAST);
  });

  it('lifts the dark swatches that the raw table loses against the rim', () => {
    const lost = PLAYER_SWATCH_COLORS.filter(
      (swatch) => contrastRatio(swatch, MARKER_RIM_COLOUR) < MIN_CONTRAST,
    );
    expect(lost.length).toBeGreaterThan(0);
    for (const swatch of lost)
      expect(contrastRatio(minimapPlayerColour(swatch), MARKER_RIM_COLOUR)).toBeGreaterThanOrEqual(
        MIN_CONTRAST,
      );
  });

  it('keeps each team hue, and turns black and grey into two distinct light greys', () => {
    for (const swatch of PLAYER_SWATCH_COLORS) {
      const fill = minimapPlayerColour(swatch);
      if (chromaOf(swatch) < GREYISH_CHROMA) {
        expect(chromaOf(fill), hex(swatch)).toBe(0);
        continue;
      }
      const drift = Math.abs(hueOf(fill) - hueOf(swatch));
      expect(Math.min(drift, 360 - drift), hex(swatch)).toBeLessThanOrEqual(HUE_TOLERANCE_DEGREES);
    }
    const black = minimapPlayerColour(0x2c2c2c);
    const grey = minimapPlayerColour(0x9a9a9a);
    expect(deltaE(black, grey)).toBeGreaterThanOrEqual(MIN_DELTA_E);
    expect(black).toBeLessThan(grey);
  });

  it('never lets a player fill pass for a fauna or road dot', () => {
    for (const fill of fills)
      for (const neutral of [ANIMAL_DOT_COLOUR, ROAD_SITE_DOT_COLOUR, ROAD_DOT_COLOUR])
        expect(deltaE(fill, neutral), `${hex(fill)} vs ${hex(neutral)}`).toBeGreaterThanOrEqual(MIN_DELTA_E);
  });
});
