/**
 * `randompalette.ini` `[RandomPalette]` recipes: each `Patch <band> <source> <weight>` line offers one
 * source for a 16-index palette band, a named `[GfxPalette16]` ramp or a copy of another band.
 * `docs/formats/GRAPHICS.md` "Palettes" owns the band addressing and how a recipe is rolled.
 */

import type { RandomPalettePatch, RandomPaletteRecipe } from '@open-northland/data';
import type { RuleSection } from './ini/grammar.js';
import { normalizePaletteName } from './ini/ir-fields.js';

/** One palette band, a `Patch` target or a `[GfxPalette16]` ramp, is 16 indices. */
const BAND_LENGTH = 16;
/** RGB bytes per palette entry. */
const RGB_BYTES = 3;

/** Original behavior: the section and its keys match regardless of case; one shipped recipe writes some
 *  of its lines as `patch`. */
const RECIPE_SECTION = 'randompalette';
const NAME_KEY = 'name';
const PATCH_KEY = 'patch';

/** A bare integer source copies that band; the tokenizer drops quotes, so a ramp named by digits alone
 *  would read as a copy, which no shipped recipe does. */
const COPY_SOURCE = /^\d+$/;

function readPatch(values: readonly string[]): RandomPalettePatch | undefined {
  const [bandRaw, raw, weightRaw] = values;
  const band = Number.parseInt(bandRaw ?? '', 10);
  const weight = Number.parseInt(weightRaw ?? '', 10);
  if (Number.isNaN(band) || Number.isNaN(weight) || raw === undefined) return undefined;
  const source = COPY_SOURCE.test(raw)
    ? ({ kind: 'copy', band: Number.parseInt(raw, 10) } as const)
    : ({ kind: 'ramp', ramp: normalizePaletteName(raw) } as const);
  return { band, source, weight };
}

/**
 * Every `[RandomPalette]` recipe in file order, names lower-cased, `Patch` lines in file order; a
 * malformed line or a section without a name is skipped. Original behavior: a name lookup returns the
 * first recipe of that name, so a later duplicate is dropped.
 */
export function extractRandomPalettes(sections: readonly RuleSection[]): RandomPaletteRecipe[] {
  const byName = new Map<string, RandomPaletteRecipe>();
  for (const sec of sections) {
    if (sec.name.toLowerCase() !== RECIPE_SECTION) continue;
    const rawName = sec.props.find((p) => p.key.toLowerCase() === NAME_KEY)?.values[0];
    if (rawName === undefined || rawName.trim() === '') continue;
    const name = normalizePaletteName(rawName);
    if (byName.has(name)) continue;
    const patches = sec.props.flatMap((p) => {
      const patch = p.key.toLowerCase() === PATCH_KEY ? readPatch(p.values) : undefined;
      return patch === undefined ? [] : [patch];
    });
    byName.set(name, { name, patches });
  }
  return [...byName.values()];
}

/** Cut a named ramp's 16 colours (48 RGB bytes) out of its source `[GfxPalette256]` palette:
 *  `gfxcolorrange` range N = palette indices `[16N, 16N+15]`. Undefined when the range overruns. */
export function cutRamp(palette: Uint8Array, range: number): Uint8Array | undefined {
  const start = range * BAND_LENGTH * RGB_BYTES;
  if (range < 0 || start + BAND_LENGTH * RGB_BYTES > palette.length) return undefined;
  return palette.subarray(start, start + BAND_LENGTH * RGB_BYTES);
}
