/**
 * `[GfxLandscape]` `.bmd`→palette bindings for the map's pre-placed decor (trees, bushes, signs,
 * wonders).
 */

import { getStr, type RuleSection } from '../grammar.js';
import { type NamedBmdPaletteBinding, readBmdPaletteBindings } from './bmd-palette.js';

/**
 * Extracts the `[GfxLandscape]` records from `.../landscapes/landscapes.cif`, which ships `.cif`-only
 * and is decoded through `decodeCifStringArray` → `cifLinesToSections`. The editor serializes these with
 * CamelCase keys (`GfxBobLibs`/`GfxPalette`/`EditName`), so the lookups match that casing. Repeated
 * `(bmd, palette)` pairs are not deduped here; deduping is the caller's concern.
 */
export function extractLandscapeGraphics(sections: readonly RuleSection[]): NamedBmdPaletteBinding[] {
  const bindings: NamedBmdPaletteBinding[] = [];
  for (const sec of sections) {
    if (sec.name !== 'GfxLandscape') continue;
    const editName = getStr(sec, 'EditName');
    for (const binding of readBmdPaletteBindings(sec, 'GfxBobLibs', 'GfxPalette')) {
      bindings.push({ ...binding, editName });
    }
  }
  return bindings;
}
