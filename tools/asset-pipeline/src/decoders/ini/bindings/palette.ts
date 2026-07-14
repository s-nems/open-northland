/**
 * Palette aliases — the first leg of the `.bmd`→palette graph: a graphics record names a bob set's
 * palette by `editname`, and `palettes.ini` resolves that name to the `.pcx` whose trailer holds the
 * actual 256 colours.
 */

import { findProps, getStr, normalizeAssetPath, normalizePaletteName, type RuleSection } from '../grammar.js';

/**
 * One resolved palette alias: a name a graphics record references (via `gfxpalettebody "<name>"`)
 * mapped to the `.pcx` whose trailer palette holds the actual 256 colours. The path is normalized to
 * a forward-slash, lower-cased, relative path so a lookup is host-OS- and case-independent (archive
 * names use Windows backslashes and mixed case, e.g. `data\Engine2D\Bin\palettes\landscapes\tree01.pcx`).
 */
export interface PaletteAlias {
  /**
   * The `editname` a graphics record references, lower-cased ({@link normalizePaletteName}): the
   * original engine looks `editname`s up case-insensitively, and the real data mixes case across the
   * two legs (e.g. `palettes.ini` declares `Lion01`/`Chicken01` while `jobgraphics.ini` references
   * `LION01`/`chicken01`). Lower-casing the join key on both sides makes the pairing resolve. One
   * record may expose several aliases for one file.
   */
  readonly name: string;
  /** The palette source `.pcx`, as a normalized `data/.../foo.pcx` relative path (forward slashes, lower-case). */
  readonly gfxFile: string;
}

/**
 * Extracts the `palettes.ini` `[GfxPalette256]` records into name→`.pcx` aliases — the first leg of the
 * `.bmd`→palette graph (see the file header). Each record carries one `gfxfile` but the grammar allows
 * several `editname` aliases; every alias is emitted pointing at the shared file, so a consumer builds
 * one flat `name → .pcx` map (143 records in the real file; the 108 `[GfxPalette16]` sub-palettes built
 * via `gfxcolorrange` with no `.pcx` are skipped by the section-name guard). A record missing its
 * `gfxfile` or `editname` is skipped. Paths are normalized ({@link normalizeAssetPath}) for
 * host-OS/case-independent lookup. The other leg (which `.bmd` uses which `editname`) lives mostly in
 * graphics `.cif` records and is wired in a later step.
 */
export function extractPaletteIndex(sections: readonly RuleSection[]): PaletteAlias[] {
  const aliases: PaletteAlias[] = [];
  for (const sec of sections) {
    if (sec.name !== 'GfxPalette256') continue;
    const gfxFile = getStr(sec, 'gfxfile');
    if (gfxFile === undefined || gfxFile.trim() === '') continue;
    const normalized = normalizeAssetPath(gfxFile);
    for (const p of findProps(sec, 'editname')) {
      const name = p.values[0];
      if (name === undefined || name.trim() === '') continue;
      aliases.push({ name: normalizePaletteName(name), gfxFile: normalized });
    }
  }
  return aliases;
}

/**
 * Collapses {@link extractPaletteIndex} output into a `name → .pcx` lookup, first alias wins on a
 * duplicate name (the real `palettes.ini` has none, but the rule keeps it deterministic). The one
 * shared reading of the alias graph the bmd + goods stages both resolve palettes through — they then
 * read the `.pcx` from different roots (the unpacked out-tree vs the game dir), so only this map
 * construction is common.
 */
export function paletteAliasMap(aliases: readonly PaletteAlias[]): Map<string, string> {
  const byName = new Map<string, string>();
  for (const alias of aliases) {
    if (!byName.has(alias.name)) byName.set(alias.name, alias.gfxFile);
  }
  return byName;
}
