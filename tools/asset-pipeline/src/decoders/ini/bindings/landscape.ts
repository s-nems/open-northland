/**
 * Landscape-object graphics bindings — the `[GfxLandscape]` `.bmd`→palette pairings for the map's
 * pre-placed decor (trees, bushes, signs, wonders), the static-object analog of the job bindings.
 */

import { getStr, type RuleSection } from '../grammar.js';
import { type NamedBmdPaletteBinding, readBmdPaletteBindings } from './bmd-palette.js';

/**
 * Extracts the `[GfxLandscape]` records from `Data/engine2d/inis/landscapes/landscapes.cif` — the
 * landscape-object graphics binding (trees, bushes, signs, wonders, harbours, …): the map's
 * pre-placed decor, the exact analog of the `[jobgraphics]` creature binding but for static objects.
 * Each record names a body + shadow bob set (`GfxBobLibs "<body>.bmd" "<shadow>.bmd"`) and the palette
 * `editname` (`GfxPalette "tree_yew01"`) that recolours it — the same `(bmd, palette)` pairing
 * `convertBmdTree` consumes, read via the shared {@link readBmdPaletteBindings}, plus the record's
 * `EditName` (a species handle: "yew 01" vs "fir 01", the only IR-layer differentiator when many records
 * share one recoloured body bob). This is the missing leg that lets `ls_trees.bmd` (and the other
 * `ls_*.bmd` decor sets) become atlases: it ships `.cif`-only (no readable `.ini` twin), so it is
 * decoded via `decodeCifStringArray` → `cifLinesToSections` like the base humans graphics. Unlike the
 * lower-cased `.ini` graphics keys, the editor serializes these records with CamelCase keys
 * (`GfxBobLibs`/`GfxPalette`/`EditName`) and a CamelCase section header (`GfxLandscape`), so the lookups
 * match that casing (and there are no `logictribe`/`logicjob` keys, so `tribeId`/`jobId` stay undefined).
 *
 * A record without a body bob (some decor is texture-only / a logic marker) or without a palette name
 * (unbindable) is skipped, never thrown — this indexes hundreds of records and one malformed entry must
 * not abort the offline batch. Repeated `(bmd, palette)` pairs (the ~99 tree species share a dozen
 * palettes) are not deduped here — the atlas filename keys on `(bmd, palette)` so a duplicate only
 * re-emits identical bytes; deduping is the caller's concern.
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
