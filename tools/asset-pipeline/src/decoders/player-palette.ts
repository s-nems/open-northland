/**
 * Player (team) colour palettes. The original composes a per-creature palette from a base body palette
 * plus a player-colour ramp bound to the clothing patches, and a `.bmd` stores palette indices, so the
 * atlas keeps raw indices and the renderer reads each one through a per-player row of a LUT texture.
 *
 * The `randompalette.ini` `player_00…09` recipes bind the `Player NN` ramp, colour-range 1 of a
 * `playerNN.pcx`, onto the men's clothing patches. The original ships 10 player colours; the extra six
 * are hue-rotated approximations with no original equivalent.
 */

import { assertPaletteBytes, PALETTE_RGB_BYTES } from './image.js';

/** First index of the source `Player NN` ramp inside a `playerNN.pcx` (colour-range 1 = indices 16–31). */
export const PLAYER_RAMP_START = 16;
/** Length of the player ramp (a 16-colour `[GfxPalette16]` ramp). */
const PLAYER_RAMP_LENGTH = 16;

/**
 * The body-palette index runs that receive a player's colour ramp: patch 10 (indices 160–175, the men's
 * vest) and patch 5 (80–95), which the `player_00…09` recipes mirror from patch 10 (`Patch 5 10 10`).
 * Everything else (skin, hair, metal, tools) is the shared base and identical across players.
 *
 * Patch 15 (240–255) is excluded because the carried-good colours live there (`good_Wood`/`good_clay`
 * set patch 14 + patch 15); only the separate `woman_NN` recipe touches that band.
 */
export const PLAYER_COLOR_BANDS: readonly (readonly [number, number])[] = [
  [80, 95],
  [160, 175],
];

export interface PlayerColorDef {
  readonly id: number;
  readonly name: string;
  /**
   * `pcx` reads the band from a shipped `playerNN.pcx`; `synthetic` hue-rotates the reference ramp to
   * `hue` degrees, an approximation with no original equivalent.
   */
  readonly source:
    | { readonly kind: 'pcx'; readonly file: string }
    | { readonly kind: 'synthetic'; readonly hue: number };
}

/**
 * The 16 player colours, slot order = player id. Ids 0–9 follow the original's `TPlayerColorId` order
 * (`logicdefines.inc`) and read their `pcx` files from `Data/engine2d/bin/palettes/creatures/`.
 */
export const PLAYER_COLORS: readonly PlayerColorDef[] = [
  { id: 0, name: 'blue', source: { kind: 'pcx', file: 'player01.pcx' } },
  { id: 1, name: 'red', source: { kind: 'pcx', file: 'player02.pcx' } },
  { id: 2, name: 'yellow', source: { kind: 'pcx', file: 'player03.pcx' } },
  { id: 3, name: 'cyan', source: { kind: 'pcx', file: 'player04.pcx' } },
  { id: 4, name: 'green', source: { kind: 'pcx', file: 'player05.pcx' } },
  { id: 5, name: 'purple', source: { kind: 'pcx', file: 'player06.pcx' } },
  { id: 6, name: 'grey', source: { kind: 'pcx', file: 'player07.pcx' } },
  { id: 7, name: 'orange', source: { kind: 'pcx', file: 'player08.pcx' } },
  { id: 8, name: 'neon', source: { kind: 'pcx', file: 'player09.pcx' } },
  { id: 9, name: 'black', source: { kind: 'pcx', file: 'player10.pcx' } },
  // Hue-rotated to fill the gaps between the shipped hues.
  { id: 10, name: 'spring', source: { kind: 'synthetic', hue: 140 } },
  { id: 11, name: 'teal', source: { kind: 'synthetic', hue: 168 } },
  { id: 12, name: 'azure', source: { kind: 'synthetic', hue: 205 } },
  { id: 13, name: 'indigo', source: { kind: 'synthetic', hue: 250 } },
  { id: 14, name: 'magenta', source: { kind: 'synthetic', hue: 312 } },
  { id: 15, name: 'pink', source: { kind: 'synthetic', hue: 336 } },
];

function assertPalette(p: Uint8Array, what: string): void {
  assertPaletteBytes(p, 'player-palette', what);
}

/**
 * A detached 768-byte copy of a palette. Not `p.slice()`: a decoded `.pcx` palette is a Node `Buffer`,
 * whose `slice` returns a view sharing memory, so every composed palette would alias one buffer.
 */
function copyPalette(p: Uint8Array): Uint8Array {
  const out = new Uint8Array(PALETTE_RGB_BYTES);
  out.set(p.subarray(0, PALETTE_RGB_BYTES));
  return out;
}

/**
 * Composes one player's palette: a copy of the shared body palette `base` with every
 * {@link PLAYER_COLOR_BANDS} run overwritten by `source`'s 16-colour ramp at {@link PLAYER_RAMP_START}.
 * Both inputs are 768-byte RGB triples.
 */
export function composePlayerPalette(base: Uint8Array, source: Uint8Array): Uint8Array {
  assertPalette(base, 'base palette');
  assertPalette(source, 'source palette');
  const out = copyPalette(base);
  for (const [lo] of PLAYER_COLOR_BANDS) {
    for (let k = 0; k < PLAYER_RAMP_LENGTH; k++) {
      const s = (PLAYER_RAMP_START + k) * 3;
      const o = (lo + k) * 3;
      out[o] = source[s] ?? 0;
      out[o + 1] = source[s + 1] ?? 0;
      out[o + 2] = source[s + 2] ?? 0;
    }
  }
  return out;
}

/** RGB (0–255) → HSV with h in [0,360), s/v in [0,1]. */
function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  return [h, s, max];
}

/** HSV (h in degrees, s/v in [0,1]) → RGB (0–255, rounded). */
function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = v - c;
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

/**
 * Builds a synthetic player source by hue-rotating `reference`'s ramp to `hueDeg`, keeping each entry's
 * saturation and value so a synthesised colour shades like a shipped one. Near-grey entries stay
 * neutral. Returns a full 768-byte palette of which only the ramp differs.
 */
export function synthesizePlayerSource(reference: Uint8Array, hueDeg: number): Uint8Array {
  assertPalette(reference, 'reference palette');
  const out = copyPalette(reference);
  for (let k = 0; k < PLAYER_RAMP_LENGTH; k++) {
    const o = (PLAYER_RAMP_START + k) * 3;
    const [, s, v] = rgbToHsv(reference[o] ?? 0, reference[o + 1] ?? 0, reference[o + 2] ?? 0);
    const [r, g, b] = hsvToRgb(hueDeg, s, v);
    out[o] = r;
    out[o + 1] = g;
    out[o + 2] = b;
  }
  return out;
}
