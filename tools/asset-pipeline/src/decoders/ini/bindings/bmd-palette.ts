/**
 * The `.bmd`→palette pairing shared by every graphics-binding schema (`[jobgraphics]`, `[GfxLandscape]`,
 * `[GfxHouse]`), which differ only in section name, key spelling, and single-vs-multi palette.
 */

import {
  findProp,
  getInt,
  getStr,
  normalizeAssetPath,
  normalizeOptionalPath,
  normalizePaletteName,
  type RuleSection,
} from '../grammar.js';

/**
 * One bob set's palette pairing: a `.bmd` body (and its optional shadow) bound to the palette `editname`
 * its graphics record names. Paths are normalized to lower-case forward slashes so a lookup against the
 * unpacked `--out` tree is host-OS- and case-independent.
 */
export interface BmdPaletteBinding {
  /** The body bob set, as a normalized `data/.../foo.bmd` relative path (forward slashes, lower-case). */
  readonly bmd: string;
  /** The matching shadow bob set, same normalization, or `undefined` when the record has no shadow `.bmd`. */
  readonly shadowBmd: string | undefined;
  /** The palette `editname` the record references, lower-cased so it joins case-insensitively onto the
   *  palette alias `name` (the two legs disagree on case in the real data). */
  readonly paletteName: string;
  /** The record's `logictribe` id, when the section's schema carries the key. */
  readonly tribeId: number | undefined;
  /** The record's `logicjob` id, when the section's schema carries the key. */
  readonly jobId: number | undefined;
}

/** A {@link BmdPaletteBinding} plus the record's `EditName`, the shape the `[GfxLandscape]` and
 *  `[GfxHouse]` bindings share. */
export interface NamedBmdPaletteBinding extends BmdPaletteBinding {
  /** The record's `EditName`, a species or building handle (`"yew 01"`, `"viking stock"`): the only
   *  IR-layer differentiator when many records share one body bob recoloured per palette. */
  readonly editName: string | undefined;
}

/**
 * Reads one graphics record's `.bmd`→palette binding(s): the body `.bmd` (+ optional shadow) from
 * `bobKey`, the palette editname(s) from `paletteKey`. `multiPalette` fans one binding per palette value
 * on the line (a `[GfxHouse]` body carries several skins on one `GfxPalette`); otherwise only the first
 * value is read. Cross-refs come from the lowercase `logictribe`/`logicjob` keys the job schema uses,
 * which the CamelCase `[GfxLandscape]`/`[GfxHouse]` sections do not carry.
 */
export function readBmdPaletteBindings(
  sec: RuleSection,
  bobKey: string,
  paletteKey: string,
  multiPalette = false,
): BmdPaletteBinding[] {
  const libs = findProp(sec, bobKey);
  const bmd = libs?.values[0];
  if (bmd === undefined || bmd.trim() === '') return [];
  let paletteNames: string[];
  if (multiPalette) {
    paletteNames = (findProp(sec, paletteKey)?.values ?? []).filter((v) => v.trim() !== '');
  } else {
    const one = getStr(sec, paletteKey);
    paletteNames = one !== undefined && one.trim() !== '' ? [one] : [];
  }
  if (paletteNames.length === 0) return [];
  const bmdPath = normalizeAssetPath(bmd);
  const shadowBmd = normalizeOptionalPath(libs?.values[1]);
  const tribeId = getInt(sec, 'logictribe');
  const jobId = getInt(sec, 'logicjob');
  return paletteNames.map((paletteName) => ({
    bmd: bmdPath,
    shadowBmd,
    paletteName: normalizePaletteName(paletteName),
    tribeId,
    jobId,
  }));
}
