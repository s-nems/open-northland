/**
 * Player (team) colour palettes — the data behind "player 0 is blue, player 1 is red, …". The original
 * *Cultures* engine gives each unit a per-creature palette composed from a base body palette plus a
 * player-colour ramp bound to the clothing/equipment patches; the unit's `.bmd` stores palette indices,
 * so the final colour is decided by whichever palette the index is read through. We reproduce that as a
 * render-time lookup: the character atlas keeps its raw indices (see `expandBobFrameIndexed` in
 * `atlas.ts`) and the renderer reads each index through a per-player palette row in a LUT texture.
 *
 * How the player colour is applied: the RandomPalette recipe (`randompalette.ini`, `player_00…09`) binds the
 * `Player NN` ramp — a 16-colour ramp at colour-range 1 of a `playerNN.pcx` ({@link PLAYER_RAMP_START}) — onto
 * the men's clothing patches: patch 10 (men's vest, indices 160–175) and patch 5 (80–95), which the recipe
 * mirrors from patch 10. Those target index runs are {@link PLAYER_COLOR_BANDS}; each receives the full
 * 16-colour ramp. So a per-player palette is the shared base body palette with those bands overwritten by that
 * player's ramp — {@link composePlayerPalette}. (Confirmed visually: the base `test_human_00`'s patch 10 is the
 * cyan default vest, and remapping it turns the civilian's vest the player colour.) Patch 15 (240–255, the
 * carried-good + women's-dress band) is deliberately excluded — see {@link PLAYER_COLOR_BANDS}.
 *
 * The original ships 10 player colours; we generate 16 (up to 16 players) by hue-rotating a reference ramp
 * for the extra six — a conscious divergence, logged in source basis. Pure functions only (palette maths on
 * 768-byte RGB triples + RGBA LUT images); the I/O that reads the `.pcx` sources + writes the LUT PNG lives
 * in the pipeline stage.
 */

import { assertPaletteBytes, PALETTE_ENTRIES, PALETTE_RGB_BYTES, type RgbaImage } from './image.js';

/** First index of the source `Player NN` ramp inside a `playerNN.pcx` (colour-range 1 = indices 16–31). */
export const PLAYER_RAMP_START = 16;
/** Length of the player ramp (a 16-colour `[GfxPalette16]` ramp). */
export const PLAYER_RAMP_LENGTH = 16;

/**
 * The body-palette index runs that receive a player's colour ramp. These are the patches the original's
 * per-player recipe (`randompalette.ini` `player_00…09`) actually binds the `Player NN` ramp onto: **patch
 * 10** (indices 160–175, the men's vest) and **patch 5** (80–95), which the recipe mirrors from patch 10
 * (`Patch 5 10 10`). Each `[lo, hi]` run is exactly {@link PLAYER_RAMP_LENGTH} wide and is overwritten with
 * the full ramp, so a body only shows the colour on the patches it actually uses; everything else
 * (skin/hair/metal/tools) is the shared base and identical across players.
 *
 * **Patch 15 (240–255) is deliberately NOT here.** That band is where the CARRIED-GOOD colours live
 * (`good_Wood`/`good_clay`/… set patch 14 + patch 15), so remapping it painted a hauled log/clay slab the
 * team colour — the "blue wood" bug. The `player_NN` recipe never touches patch 15; only the separate
 * `woman_NN` recipe (women's dress) does. Reproducing women's dress colour needs a per-body-class ramp
 * (man → patch 10, woman → patch 15) rather than this one shared band set — a deferred per-body-class
 * follow-up; keeping patch 15 base-coloured is the faithful choice for the
 * men who do the hauling.
 */
export const PLAYER_COLOR_BANDS: readonly (readonly [number, number])[] = [
  [80, 95],
  [160, 175],
];

/** One player colour: its slot id, a human name, and where its band colours come from. */
export interface PlayerColorDef {
  readonly id: number;
  readonly name: string;
  /**
   * `pcx`: read the band from a shipped `playerNN.pcx` (the faithful 10). `synthetic`: hue-rotate the
   * reference ramp to `hue` degrees (the 6 extras — a recorded divergence, no original equivalent).
   */
  readonly source:
    | { readonly kind: 'pcx'; readonly file: string }
    | { readonly kind: 'synthetic'; readonly hue: number };
}

/**
 * The 16 player colours, slot order = player id. Ids 0–9 are the original's `TPlayerColorId` order
 * (`logicdefines.inc`): blue is the human player's default, then red/yellow/cyan/green/purple/grey/orange/
 * neon/black. Ids 10–15 have NO original equivalent — six hue-rotated ramps chosen to sit in the gaps
 * between the shipped hues (a divergence, see source basis). The `pcx` files are read from the game's
 * `Data/engine2d/bin/palettes/creatures/`.
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
  // Six extras with no original — hue-rotated to fill the gaps between the shipped hues.
  { id: 10, name: 'spring', source: { kind: 'synthetic', hue: 140 } },
  { id: 11, name: 'teal', source: { kind: 'synthetic', hue: 168 } },
  { id: 12, name: 'azure', source: { kind: 'synthetic', hue: 205 } },
  { id: 13, name: 'indigo', source: { kind: 'synthetic', hue: 250 } },
  { id: 14, name: 'magenta', source: { kind: 'synthetic', hue: 312 } },
  { id: 15, name: 'pink', source: { kind: 'synthetic', hue: 336 } },
];

/** Length-checks a palette with the shared guard, stamping this module's namespace on the error. */
function assertPalette(p: Uint8Array, what: string): void {
  assertPaletteBytes(p, 'player-palette', what);
}

/**
 * A DETACHED 768-byte copy of a palette. Deliberately not `p.slice()`: a decoded `.pcx` palette is a Node
 * `Buffer` (`Buffer.prototype.slice` returns a VIEW that shares memory, unlike `Uint8Array.prototype.slice`),
 * so slicing it and writing to the "copy" would corrupt the shared base — every composed player palette would
 * alias one buffer and collapse to the last one. `new Uint8Array` + `.set` always copies.
 */
function copyPalette(p: Uint8Array): Uint8Array {
  const out = new Uint8Array(PALETTE_RGB_BYTES);
  out.set(p.subarray(0, PALETTE_RGB_BYTES));
  return out;
}

/**
 * Compose one player's 256-colour palette: a copy of `base` with every {@link PLAYER_COLOR_BANDS} clothing
 * patch overwritten by `source`'s 16-colour player ramp (`source[{@link PLAYER_RAMP_START} .. +16]`). `base`
 * is the shared human body palette (skin/hair/metal); `source` is a player palette (`playerNN.pcx` or a
 * synthesised one) whose ramp carries that player's team colour. Both are 768-byte RGB triples; throws
 * (`player-palette:` prefix) on a wrong-sized input.
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
 * Build a synthetic player source by hue-rotating `reference`'s band to `hueDeg`, keeping each entry's
 * saturation + value. This reuses a real ramp's dark→bright SHAPE (so a synthesised colour shades like a
 * shipped one) while giving it a new hue — the basis for the six extra player colours. Returns a full
 * 768-byte palette; only its band matters to {@link composePlayerPalette}. Grey/near-grey band entries
 * (saturation ~0, e.g. the ramp's dark anchor) stay neutral, since hue is meaningless there.
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

/**
 * Stack `palettes` (each a 256-colour 768-byte RGB triple set, one per player) into a
 * `256 × palettes.length` RGBA LUT image: pixel `(x, y)` = palette `y`'s colour at index `x`, alpha 255
 * (sprite transparency comes from the indexed atlas mask, never the LUT). The renderer uploads this as a
 * nearest-sampled texture and reads `LUT[index, playerRow]` per pixel. Throws (`player-palette:` prefix)
 * on a wrong-sized palette or an empty list.
 */
export function buildPlayerLutImage(palettes: readonly Uint8Array[]): RgbaImage {
  if (palettes.length === 0) throw new Error('player-palette: need at least one palette for the LUT');
  const width = PALETTE_ENTRIES;
  const height = palettes.length;
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const pal = palettes[y];
    if (pal === undefined) continue;
    assertPalette(pal, `palette row ${y}`);
    for (let x = 0; x < width; x++) {
      const src = x * 3;
      const dst = (y * width + x) * 4;
      rgba[dst] = pal[src] ?? 0;
      rgba[dst + 1] = pal[src + 1] ?? 0;
      rgba[dst + 2] = pal[src + 2] ?? 0;
      rgba[dst + 3] = 0xff;
    }
  }
  return { width, height, rgba };
}
