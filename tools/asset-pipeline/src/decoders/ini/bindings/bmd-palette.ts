/**
 * Graphics-bindings kernel: the `.bmd`→palette pairing shared by every graphics-binding schema
 * (`[jobgraphics]`, `[GfxLandscape]`, `[GfxHouse]`), which differ only in section name, key spelling, and
 * single-vs-multi palette. {@link readBmdPaletteBindings} reads one record's binding(s); the per-schema
 * extractors wrap it (the landscape/building legs add the record's `EditName`).
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
 * One bob set's palette pairing: a `.bmd` body (and its optional shadow `.bmd`) bound to the palette
 * `editname` its graphics record names — the second leg of the `.bmd`→palette graph. The first leg
 * ({@link import('./palette.js').extractPaletteIndex}) resolves `paletteName` to a `.pcx` trailer palette;
 * together they answer "which 256 colours colour this `.bmd`". The `.bmd` paths are normalized
 * (forward-slash, lower-case) so a lookup against the unpacked `--out` tree is host-OS/case-independent,
 * matching {@link import('./palette.js').PaletteAlias.gfxFile}.
 */
export interface BmdPaletteBinding {
  /** The body bob set, as a normalized `data/.../foo.bmd` relative path (forward slashes, lower-case). */
  readonly bmd: string;
  /** The matching shadow bob set, same normalization, or `undefined` when the record has no shadow `.bmd`. */
  readonly shadowBmd: string | undefined;
  /**
   * The palette `editname` the record references, lower-cased ({@link normalizePaletteName}) so it
   * joins case-insensitively onto the palette alias `name` (the two legs disagree on case in the real
   * data).
   */
  readonly paletteName: string;
  /** The `logictribe` id the record applies to, when present (a cross-reference, not required). */
  readonly tribeId: number | undefined;
  /** The `logicjob` id the record applies to, when present (a cross-reference, not required). */
  readonly jobId: number | undefined;
}

/**
 * A {@link BmdPaletteBinding} plus the record's `EditName` — the shape the `[GfxLandscape]` (map decor)
 * and `[GfxHouse]` (building) bindings share. The name is a species/building handle ("yew 01" vs "fir
 * 01", "viking stock" vs "viking home"): the only IR-layer differentiator when many records share one
 * body bob recoloured per palette.
 */
export interface NamedBmdPaletteBinding extends BmdPaletteBinding {
  /** The record's `EditName` (e.g. `"yew 01"` / `"viking stock"`), or undefined when the record omits it. */
  readonly editName: string | undefined;
}

/**
 * Reads one graphics record's `.bmd`→palette binding(s): the body `.bmd` (+ optional shadow) from
 * `bobKey`, and the palette editname(s) from `paletteKey`. With `multiPalette` it fans one binding per
 * palette value on the line (a `[GfxHouse]` body carries several skins on one `GfxPalette`); otherwise the
 * first value only. Paths normalize (forward-slash, lower-case); the palette name lower-cases to join
 * case-insensitively onto the alias `name`. A record with no body `.bmd` or no palette yields no
 * bindings (never throws). Cross-refs read from the lowercase `logictribe`/`logicjob` keys the job
 * schema uses; the CamelCase `[GfxLandscape]`/`[GfxHouse]` sections have no such keys, so both come back
 * undefined there.
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
