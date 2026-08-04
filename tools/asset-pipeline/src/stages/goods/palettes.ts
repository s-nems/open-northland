import { join } from 'node:path';
import { extractPaletteIndex, iniBytesToSections, paletteAliasMap } from '../../decoders/ini.js';
import { decodePcx } from '../../decoders/pcx.js';
import { errorMessage } from '../../errors.js';
import type { SourceRoots } from '../../roots.js';
import { readSourceFile } from '../source-files.js';

/** The palette alias table: `[GfxPalette256]` records mapping a palette editname to its real `.pcx`
 *  (`gold01` → `landscapes/gold.pcx`). */
const PALETTES_INI = join('Data', 'engine2d', 'inis', 'palettes', 'palettes.ini');
/** Fallback dirs a `goods_*` recolor palette `.pcx` may live in when the alias table has no entry. */
const PALETTE_DIRS = [
  join('Data', 'engine2d', 'bin', 'palettes', 'goods'),
  join('Data', 'engine2d', 'bin', 'palettes', 'landscapes'),
];

/** A palette editname (lower-cased) → its real `.pcx` path, from {@link PALETTES_INI}. */
export type PaletteAliasMap = ReadonlyMap<string, string>;

/** Read {@link PALETTES_INI} into a name→`.pcx` alias map, empty when the file is unreadable so resolution
 *  degrades to the {@link PALETTE_DIRS} search. */
export async function loadPaletteAliases(roots: SourceRoots): Promise<PaletteAliasMap> {
  try {
    const sections = iniBytesToSections(await readSourceFile(roots, PALETTES_INI));
    return paletteAliasMap(extractPaletteIndex(sections));
  } catch (err) {
    console.warn(`[pipeline] goods: palettes.ini unreadable (${errorMessage(err)}); resolving by path`);
    return new Map();
  }
}

/**
 * Resolve a recolor palette by name to its 256-colour table, through the {@link PALETTES_INI} alias graph
 * first because a palette name rarely matches a `<name>.pcx` directly: without it the aliased landscape
 * palettes fall to a neutral row and their goods render washed-out white. Falls back to the
 * {@link PALETTE_DIRS} search, then `undefined`.
 */
export async function loadGoodsPalette(
  roots: SourceRoots,
  name: string,
  aliases: PaletteAliasMap,
): Promise<Uint8Array | undefined> {
  const aliased = aliases.get(name.toLowerCase());
  if (aliased !== undefined) {
    try {
      return decodePcx(await readSourceFile(roots, aliased)).palette;
    } catch {
      // aliased file unreadable - fall through to the by-path search
    }
  }
  for (const dir of PALETTE_DIRS) {
    try {
      return decodePcx(await readSourceFile(roots, join(dir, `${name}.pcx`))).palette;
    } catch {
      // try the next dir
    }
  }
  return undefined;
}
