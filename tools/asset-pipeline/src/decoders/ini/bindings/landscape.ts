/**
 * Landscape-object graphics bindings — the `[GfxLandscape]` `.bmd`→palette pairings for the map's
 * pre-placed decor (trees, bushes, signs, wonders), the static-object analog of the job bindings.
 */

import { getStr, type RuleSection } from '../grammar.js';
import { type NamedBmdPaletteBinding, readBmdPaletteBindings } from './bmd-palette.js';

/**
 * Extracts the `[GfxLandscape]` records from `.../landscapes/landscapes.cif` — the landscape-object
 * binding for the map's pre-placed decor (trees, bushes, signs, wonders, …). Each record pairs a body +
 * shadow bob set (`GfxBobLibs`) with a palette `editname` (`GfxPalette`) — the `(bmd, palette)` pairing
 * `convertBmdTree` consumes, read via the shared {@link readBmdPaletteBindings} — plus its `EditName`
 * (a species handle, "yew 01" vs "fir 01": the only IR differentiator when records share one recoloured
 * bob). Ships `.cif`-only, decoded via `decodeCifStringArray` → `cifLinesToSections`. The editor
 * serializes these with CamelCase keys (`GfxBobLibs`/`GfxPalette`/`EditName`) and header, so the lookups
 * match that casing; there are no `logictribe`/`logicjob` keys, so `tribeId`/`jobId` stay undefined.
 *
 * A record without a body bob or palette is skipped. Repeated `(bmd, palette)` pairs (the ~99 tree
 * species share a dozen palettes) are not deduped here — `convertBmdTree` keys on `(bmd, palette)`, so a
 * duplicate only re-emits identical bytes; deduping is the caller's concern.
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
