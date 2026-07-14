import { join } from 'node:path';
import { decodeIni, extractPaletteIndex, paletteAliasMap, parseIniSections } from '../../decoders/ini.js';
import { decodePcx } from '../../decoders/pcx.js';
import { readGameFile } from '../game-file.js';

/**
 * Recolour-palette resolution for the goods stage: a `goods_*`/landscape palette name → its 256-colour
 * table, first via the `palettes.ini` alias graph (`gold01` → `landscapes/gold.pcx`), then a direct
 * search of the goods/landscape palette dirs. The same resolution the bmd stage uses.
 */

/** The palette ALIAS table: `[GfxPalette256]` records mapping a palette editname (`gold01`) to its real
 *  `.pcx` — a name rarely names a `<name>.pcx` file directly (`gold01` → `landscapes/gold.pcx`). */
const PALETTES_INI = join('Data', 'engine2d', 'inis', 'palettes', 'palettes.ini');
/** Fallback dirs a `goods_*` recolor palette `.pcx` may live in when the alias table has no entry. */
const PALETTE_DIRS = [
  join('Data', 'engine2d', 'bin', 'palettes', 'goods'),
  join('Data', 'engine2d', 'bin', 'palettes', 'landscapes'),
];

/** A palette editname (lower-cased) → its real `.pcx` path, from {@link PALETTES_INI}. Built once per run. */
export type PaletteAliasMap = ReadonlyMap<string, string>;

/** Read {@link PALETTES_INI} into a name→`.pcx` alias map (the same graph the bmd stage uses). Empty (and
 *  warned) when the file is unreadable, so palette resolution degrades to the {@link PALETTE_DIRS} search. */
export async function loadPaletteAliases(gameDir: string): Promise<PaletteAliasMap> {
  try {
    const sections = parseIniSections(decodeIni(await readGameFile(gameDir, PALETTES_INI)));
    return paletteAliasMap(extractPaletteIndex(sections));
  } catch (err) {
    console.warn(`[pipeline] goods: palettes.ini unreadable (${(err as Error).message}); resolving by path`);
    return new Map();
  }
}

/**
 * Resolve a recolor palette by name to its 256-colour table. First via the {@link PALETTES_INI} alias graph
 * (`gold01` → `landscapes/gold.pcx`) — a palette name rarely matches a `<name>.pcx` file directly, so without
 * this the aliased landscape palettes (`gold01`/`clay01`/`house_saracen01`/`human_colors`) fall to a neutral
 * row and their goods render washed-out white in the HUD (the coin, the plate/wool armour). Falls back to the
 * direct {@link PALETTE_DIRS} search for a name with no alias entry; `undefined` if unresolved everywhere.
 */
export async function loadGoodsPalette(
  gameDir: string,
  name: string,
  aliases: PaletteAliasMap,
): Promise<Uint8Array | undefined> {
  const aliased = aliases.get(name.toLowerCase());
  if (aliased !== undefined) {
    try {
      return decodePcx(await readGameFile(gameDir, aliased)).palette;
    } catch {
      // aliased file unreadable — fall through to the by-path search
    }
  }
  for (const dir of PALETTE_DIRS) {
    try {
      return decodePcx(await readGameFile(gameDir, join(dir, `${name}.pcx`))).palette;
    } catch {
      // try the next dir
    }
  }
  return undefined;
}
