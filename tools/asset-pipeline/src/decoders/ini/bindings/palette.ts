/**
 * Palette aliases: a graphics record names a bob set's palette by `editname`, and `palettes.ini`
 * resolves that name to the `.pcx` whose trailer holds the actual 256 colours.
 */

import type { RuleSection } from '../grammar.js';
import { normalizeAssetPath, normalizePaletteName } from '../ir-fields.js';
import { findProp, findProps, getStr } from '../props.js';

/** One resolved palette alias: a name a graphics record references (via `gfxpalettebody "<name>"`)
 *  mapped to the `.pcx` whose trailer palette holds the actual 256 colours. */
export interface PaletteAlias {
  /** The `editname` a graphics record references, lower-cased: the real data mixes case across the two
   *  legs (`palettes.ini` declares `Lion01`, `jobgraphics.ini` references `LION01`), so both sides
   *  lower-case the join key. */
  readonly name: string;
  /** The palette source `.pcx`, normalized to a lower-case forward-slash relative path (the `.ini`
   *  references use Windows backslashes and mixed case). */
  readonly gfxFile: string;
}

/**
 * Extracts the `palettes.ini` `[GfxPalette256]` records into name→`.pcx` aliases. A record carries one
 * `gfxfile` but the grammar allows several `editname` aliases, and every alias is emitted pointing at
 * the shared file. The `[GfxPalette16]` sub-palettes carry no `.pcx` and are excluded by the
 * section-name guard.
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
 * Collapses {@link extractPaletteIndex} output into a `name → .pcx` lookup. First alias wins on a
 * duplicate name, which the real `palettes.ini` has none of, but the rule keeps it deterministic.
 */
export function paletteAliasMap(aliases: readonly PaletteAlias[]): Map<string, string> {
  const byName = new Map<string, string>();
  for (const alias of aliases) {
    if (!byName.has(alias.name)) byName.set(alias.name, alias.gfxFile);
  }
  return byName;
}

/** One `[GfxPalette16]` sub-palette, a named 16-colour ramp cut out of a `[GfxPalette256]` source:
 *  `gfxcolorrange "<source editname>" <range>` names the source palette and the 16-index range
 *  (`armor-palette.ts` `cutRamp` owns the index convention). */
export interface RampAlias {
  readonly name: string;
  /** The `[GfxPalette256]` editname the ramp is cut from. */
  readonly source: string;
  readonly range: number;
}

/** Extracts the `palettes.ini` `[GfxPalette16]` records built via `gfxcolorrange`, the ramps a
 *  `[RandomPalette]` recipe patches onto a body palette. First wins on a duplicate name. */
export function rampAliasMap(sections: readonly RuleSection[]): Map<string, RampAlias> {
  const byName = new Map<string, RampAlias>();
  for (const sec of sections) {
    if (sec.name !== 'GfxPalette16') continue;
    const range = findProp(sec, 'gfxcolorrange');
    const source = range?.values[0];
    const index = Number.parseInt(range?.values[1] ?? '', 10);
    const name = getStr(sec, 'editname');
    if (name === undefined || source === undefined || Number.isNaN(index)) continue;
    const key = normalizePaletteName(name);
    if (!byName.has(key)) {
      byName.set(key, { name: key, source: normalizePaletteName(source), range: index });
    }
  }
  return byName;
}
