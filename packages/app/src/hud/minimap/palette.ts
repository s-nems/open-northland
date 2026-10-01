import type { DiplomacyState } from '@open-northland/sim';
import { PLAYER_SWATCH_COLORS } from '../../catalog/roster.js';

/** The rim every owned marker wears; the marker fills below are chosen to stand out against it. */
export const MARKER_RIM_COLOUR = 0x1a120a;

/** Stance colours, after the self/ally/enemy modes of other strategy games: self white, friends teal,
 *  enemies red, anyone else amber. Authored. */
export const STANCE_SELF_COLOUR = 0xf4f4f4;
export const STANCE_COLOURS: Readonly<Record<DiplomacyState, number>> = {
  friend: 0x2fd7ff,
  enemy: 0xff3b30,
  neutral: 0xf2c94c,
};

/** The HSL band a player swatch is lifted into, so a dark or dull team colour still reads on the ground.
 *  Approximations, tuned on the natural ground of the shipped maps. */
const MIN_LIGHTNESS = 0.5;
const MAX_LIGHTNESS = 0.7;
const MIN_SATURATION = 0.75;
/** Below this saturation a swatch counts as grey and keeps no hue. */
const ACHROMATIC_SATURATION = 0.1;
/** Achromatic swatches become light greys, still ordered by their own lightness so black and grey
 *  stay apart: black lands near the floor, grey near white. */
const GREY_FLOOR_LIGHTNESS = 0.55;
const GREY_LIGHTNESS_SPAN = 0.5;
/** A blue, violet or red fill at the band's floor is still dark against the rim and the forest; lift it
 *  until it reaches this WCAG contrast. Well over the 3:1 floor for non-text graphics: at 3.5 the own blue
 *  still sank into dark green ground. Tuned by eye. */
const MIN_RIM_CONTRAST = 4.5;
const LIGHTNESS_STEP = 0.02;
/** Ceiling for that lift, so a fill never washes out to white. */
const LIFT_CEILING_LIGHTNESS = 0.8;

interface Hsl {
  readonly h: number;
  readonly s: number;
  readonly l: number;
}

function toHsl(colour: number): Hsl {
  const r = ((colour >> 16) & 0xff) / 0xff;
  const g = ((colour >> 8) & 0xff) / 0xff;
  const b = (colour & 0xff) / 0xff;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const chroma = max - min;
  if (chroma === 0) return { h: 0, s: 0, l };
  const s = chroma / (1 - Math.abs(2 * l - 1));
  const sector =
    max === r ? ((g - b) / chroma + 6) % 6 : max === g ? (b - r) / chroma + 2 : (r - g) / chroma + 4;
  return { h: sector * 60, s, l };
}

function fromHsl({ h, s, l }: Hsl): number {
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const sector = h / 60;
  const x = chroma * (1 - Math.abs((sector % 2) - 1));
  const [r, g, b] =
    sector < 1
      ? [chroma, x, 0]
      : sector < 2
        ? [x, chroma, 0]
        : sector < 3
          ? [0, chroma, x]
          : sector < 4
            ? [0, x, chroma]
            : sector < 5
              ? [x, 0, chroma]
              : [chroma, 0, x];
  const m = l - chroma / 2;
  const channel = (value: number): number => Math.round(Math.min(1, Math.max(0, value + m)) * 0xff);
  return (channel(r) << 16) | (channel(g) << 8) | channel(b);
}

/** WCAG relative luminance of a packed `0xRRGGBB` colour. */
export function relativeLuminance(colour: number): number {
  const linear = (byte: number): number => {
    const c = byte / 0xff;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * linear((colour >> 16) & 0xff) +
    0.7152 * linear((colour >> 8) & 0xff) +
    0.0722 * linear(colour & 0xff)
  );
}

/** WCAG contrast ratio between two packed colours, 1 to 21. */
export function contrastRatio(a: number, b: number): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** A player swatch lifted into the minimap's readable band: the hue stays, lightness and saturation
 *  rise until the fill stands clear of its dark rim. */
export function minimapPlayerColour(swatch: number): number {
  const { h, s, l } = toHsl(swatch);
  if (s < ACHROMATIC_SATURATION)
    return fromHsl({ h: 0, s: 0, l: Math.min(1, GREY_FLOOR_LIGHTNESS + l * GREY_LIGHTNESS_SPAN) });
  const lifted = {
    h,
    s: Math.max(s, MIN_SATURATION),
    l: Math.min(MAX_LIGHTNESS, Math.max(MIN_LIGHTNESS, l)),
  };
  let colour = fromHsl(lifted);
  for (
    let lightness = lifted.l;
    contrastRatio(colour, MARKER_RIM_COLOUR) < MIN_RIM_CONTRAST && lightness < LIFT_CEILING_LIGHTNESS;
    lightness += LIGHTNESS_STEP
  )
    colour = fromHsl({ ...lifted, l: Math.min(LIFT_CEILING_LIGHTNESS, lightness + LIGHTNESS_STEP) });
  return colour;
}

/** Every swatch through {@link minimapPlayerColour}, indexed like `PLAYER_SWATCH_COLORS`. */
export const MINIMAP_PLAYER_COLOURS: readonly number[] = PLAYER_SWATCH_COLORS.map(minimapPlayerColour);
