/**
 * Landscape-object graphics bindings — the `[GfxLandscape]` `.bmd`→palette pairings for the map's
 * pre-placed decor (trees, bushes, signs, wonders), the static-object analog of the job bindings.
 */

import {
  findProp,
  getStr,
  normalizeAssetPath,
  normalizeOptionalPath,
  normalizePaletteName,
  type RuleSection,
} from '../grammar.js';
import type { BmdPaletteBinding } from './job.js';

/**
 * One landscape-object graphics binding: a {@link BmdPaletteBinding} (`.bmd` body + shadow + palette
 * editname) plus the record's `EditName`. The name is provenance and a **species handle** — a render
 * binding picks "yew 01" vs "fir 01" by it without re-reading the `.cif`, and many records share one
 * body bob recoloured per palette, so the name is the only thing distinguishing them at the IR layer.
 */
export interface LandscapeGraphicsBinding extends BmdPaletteBinding {
  /** The record's `EditName` (e.g. `"yew 01"`), or undefined when the record omits it. */
  readonly editName: string | undefined;
}

/**
 * Extracts the `[GfxLandscape]` records from `Data/engine2d/inis/landscapes/landscapes.cif` — the
 * **landscape-object** graphics binding (trees, bushes, signs, wonders, harbours, …): the map's
 * pre-placed decor, the exact analog of the `[jobgraphics]` creature binding but for static objects.
 * Each record names a body + shadow bob set (`GfxBobLibs "<body>.bmd" "<shadow>.bmd"`) and the palette
 * `editname` (`GfxPalette "tree_yew01"`) that recolours it — the same `(bmd, palette)` pairing
 * `convertBmdTree` consumes, completing what the `.bmd` container itself lacks. This is the
 * missing leg that lets `ls_trees.bmd` (and the other `ls_*.bmd` decor sets) become atlases: it ships
 * **`.cif`-only** (no readable `.ini` twin), so it is decoded via `decodeCifStringArray` →
 * `cifLinesToSections` like the base humans graphics. Unlike the lower-cased `.ini` graphics
 * keys, the editor serializes these records with **CamelCase** keys (`GfxBobLibs`/`GfxPalette`/
 * `EditName`) and a CamelCase section header (`GfxLandscape`), so the lookups match that casing.
 *
 * A record without a body bob (some decor is texture-only / a logic marker) or without a palette name
 * (unbindable) is skipped, never thrown — this indexes hundreds of records and one malformed entry must
 * not abort the offline batch (matching {@link import('./job.js').extractGraphicsBindings}).
 * `tribeId`/`jobId` are always undefined (a landscape object has neither cross-ref). Repeated
 * `(bmd, palette)` pairs (the ~99 tree species share a dozen palettes) are **not** deduped here — the
 * atlas filename keys on `(bmd, palette)` so a duplicate only re-emits identical bytes; deduping is the
 * caller's concern.
 */
export function extractLandscapeGraphics(sections: readonly RuleSection[]): LandscapeGraphicsBinding[] {
  const bindings: LandscapeGraphicsBinding[] = [];
  for (const sec of sections) {
    if (sec.name !== 'GfxLandscape') continue;
    const libs = findProp(sec, 'GfxBobLibs');
    const bmd = libs?.values[0];
    if (bmd === undefined || bmd.trim() === '') continue;
    const paletteName = getStr(sec, 'GfxPalette');
    if (paletteName === undefined || paletteName.trim() === '') continue;
    const shadow = libs?.values[1];
    bindings.push({
      bmd: normalizeAssetPath(bmd),
      shadowBmd: normalizeOptionalPath(shadow),
      paletteName: normalizePaletteName(paletteName),
      tribeId: undefined,
      jobId: undefined,
      editName: getStr(sec, 'EditName'),
    });
  }
  return bindings;
}
