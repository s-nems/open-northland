/**
 * Armor recolor recipes - how the original tells a wool/leather/chain/plate wearer apart: the same
 * body bob read through a patched palette, not a separate sprite. `randompalette.ini` defines one
 * `[RandomPalette]` recipe per `TArmorType` (`human_armor_000`..`004`, the format string both game
 * exes carry); each `Patch <band> <source> <weight>` line overwrites one 16-index palette band
 * ({@link cutRamp}; the clothing patches 5/9/11/12) with either a named `[GfxPalette16]` ramp or a
 * copy of another band. Composed on top of the per-player palette
 * ({@link import('./player-palette.js').composePlayerPalette}), one LUT row per (armor tier, player).
 */

import { assertPaletteBytes, PALETTE_RGB_BYTES } from './image.js';
import { findProp, findProps, normalizePaletteName, type RuleSection } from './ini/grammar.js';

/** `TArmorType` count (`logicdefines.inc`: none/wool/leather/chain/plate) - one recipe per tier. */
export const ARMOR_PALETTE_TIERS = 5;
/** The `[RandomPalette]` recipe naming scheme, `human_armor_%3.3d` with the `TArmorType` as index. */
const ARMOR_RECIPE_NAME = /^human_armor_(\d{3})$/;
/** One palette band (a `[GfxPalette16]` ramp / one `Patch` target) is 16 palette indices. */
const BAND_LENGTH = 16;

/** One `Patch` line: overwrite `band` with a named ramp or with a copy of another band's current
 *  colours. The trailing weight is dropped - every armor recipe carries a single option per band, so
 *  the random-pick axis the weight feeds is degenerate here. */
export interface ArmorPatch {
  readonly band: number;
  readonly source:
    | { readonly kind: 'ramp'; readonly name: string }
    | { readonly kind: 'copy'; readonly band: number };
}

/** One armor tier's recipe: its `TArmorType` (0..4) and the `Patch` lines in file order. */
export interface ArmorRecipe {
  readonly tier: number;
  readonly patches: readonly ArmorPatch[];
}

/**
 * Extracts the `human_armor_NNN` recipes from `randompalette.ini` sections - only the armor family;
 * the file's other `[RandomPalette]` recipes (civilian clothing variety, hero looks) are unrelated.
 * A malformed `Patch` line (no band, no source) is skipped; first wins on a duplicate tier.
 */
export function extractArmorRecipes(sections: readonly RuleSection[]): ArmorRecipe[] {
  const byTier = new Map<number, ArmorRecipe>();
  for (const sec of sections) {
    if (sec.name !== 'RandomPalette') continue;
    const name = findProp(sec, 'Name')?.values[0];
    const match = name === undefined ? null : ARMOR_RECIPE_NAME.exec(name);
    if (match === null) continue;
    const tier = Number.parseInt(match[1] ?? '', 10);
    if (Number.isNaN(tier) || byTier.has(tier)) continue;
    const patches: ArmorPatch[] = [];
    for (const p of findProps(sec, 'Patch')) {
      const band = Number.parseInt(p.values[0] ?? '', 10);
      const raw = p.values[1];
      if (Number.isNaN(band) || raw === undefined) continue;
      const source = /^\d+$/.test(raw)
        ? ({ kind: 'copy', band: Number.parseInt(raw, 10) } as const)
        : ({ kind: 'ramp', name: normalizePaletteName(raw) } as const);
      patches.push({ band, source });
    }
    byTier.set(tier, { tier, patches });
  }
  return [...byTier.values()].sort((a, b) => a.tier - b.tier);
}

/**
 * Apply one armor recipe to a composed per-player palette: a detached copy of `palette` with each
 * `Patch` band overwritten in file order - a `ramp` source from `resolveRamp` (48 RGB bytes), a
 * `copy` source from the palette's CURRENT state, so a later patch can copy a band an earlier one
 * just wrote (`human_armor_001`'s `Patch 12 11 10` mirrors the freshly-patched band 11). Throws on
 * an unresolvable ramp or a wrong-sized input - a recipe that half-applies would silently ship a
 * wrong armor look.
 */
export function applyArmorRecipe(
  palette: Uint8Array,
  recipe: ArmorRecipe,
  resolveRamp: (name: string) => Uint8Array | undefined,
): Uint8Array {
  assertPaletteBytes(palette, 'armor-palette', 'player palette');
  const out = new Uint8Array(PALETTE_RGB_BYTES);
  out.set(palette.subarray(0, PALETTE_RGB_BYTES));
  for (const patch of recipe.patches) {
    const target = patch.band * BAND_LENGTH * 3;
    if (target + BAND_LENGTH * 3 > PALETTE_RGB_BYTES) {
      throw new Error(`armor-palette: recipe ${recipe.tier} patches out-of-range band ${patch.band}`);
    }
    if (patch.source.kind === 'copy') {
      const from = patch.source.band * BAND_LENGTH * 3;
      if (from + BAND_LENGTH * 3 > PALETTE_RGB_BYTES) {
        throw new Error(`armor-palette: recipe ${recipe.tier} copies out-of-range band ${patch.source.band}`);
      }
      out.copyWithin(target, from, from + BAND_LENGTH * 3);
    } else {
      const ramp = resolveRamp(patch.source.name);
      if (ramp === undefined || ramp.length < BAND_LENGTH * 3) {
        throw new Error(`armor-palette: recipe ${recipe.tier} names unresolved ramp "${patch.source.name}"`);
      }
      out.set(ramp.subarray(0, BAND_LENGTH * 3), target);
    }
  }
  return out;
}

/** Cut a named ramp's 16 colours (48 RGB bytes) out of its source `[GfxPalette256]` palette:
 *  `gfxcolorrange` range N = palette indices `[16N, 16N+15]`. Undefined when the range overruns. */
export function cutRamp(palette: Uint8Array, range: number): Uint8Array | undefined {
  const start = range * BAND_LENGTH * 3;
  if (start + BAND_LENGTH * 3 > palette.length) return undefined;
  return palette.subarray(start, start + BAND_LENGTH * 3);
}
