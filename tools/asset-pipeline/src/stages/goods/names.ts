import { join } from 'node:path';
import { decodeCifStringArray } from '../../decoders/cif.js';
import {
  cifLinesToSections,
  decodeIni,
  extractStringnById,
  latin1ToCp1250,
  parseIniSections,
} from '../../decoders/ini.js';
import type { SourceRoots } from '../../roots.js';
import { readSourceFile } from '../game-file.js';
import type { GoodLike } from './icons.js';

/**
 * The localized good-name join: read each locale's `text/<lang>/strings/gameobjects/goods.{ini,cif}`
 * string table and join it (good `type` → display name) onto the goods by `typeId`, producing
 * `locale → (good string id → name)`. The join ({@link resolveGoodNames}) is pure and unit-tested.
 */

/**
 * The languages whose localized good-name table we extract, most-preferred first. Each good-name string
 * file lives at `text/<dir>/strings/gameobjects/goods.{ini,cif}`; the mod ships Polish as a plaintext `.ini`
 * (CP1250, decoded directly) and English as encrypted `.cif` (byte-preserving latin1, then
 * re-decoded to CP1250 for display). The app intentionally exposes only Polish and English.
 */
const GOOD_NAME_LOCALES = [
  { code: 'pl', dir: 'pol', encrypted: false },
  { code: 'en', dir: 'eng', encrypted: true },
] as const;

/** Path of a locale's good-name string table (plaintext `.ini` when not encrypted, else the `.cif`). */
function goodNamesPath(dir: string, encrypted: boolean): string {
  return join('Data', 'text', dir, 'strings', 'gameobjects', encrypted ? 'goods.cif' : 'goods.ini');
}

/**
 * Join the localized good-name string tables (good `type` → display name, per locale) onto the goods by
 * `typeId`, producing `locale → (good string id → name)`. Pure (no I/O) so the join is unit-tested. A good
 * absent from a locale's table (or a locale with no table) simply gets no entry there; the app's fallback
 * chain covers it. The `type`-keyed singular is the faithful display name (see {@link extractStringnById}).
 */
export function resolveGoodNames(
  goods: readonly (GoodLike & { readonly typeId: number })[],
  tablesByLocale: Readonly<Record<string, Record<number, string>>>,
): Record<string, Record<string, string>> {
  const names: Record<string, Record<string, string>> = {};
  for (const [locale, table] of Object.entries(tablesByLocale)) {
    const byId: Record<string, string> = {};
    for (const good of goods) {
      const name = table[good.typeId];
      if (name !== undefined) byId[good.id] = name;
    }
    if (Object.keys(byId).length > 0) names[locale] = byId;
  }
  return names;
}

/** Read every {@link GOOD_NAME_LOCALES} good-name table (missing files skipped) and join onto the goods. */
export async function loadGoodNames(
  roots: SourceRoots,
  goods: readonly (GoodLike & { readonly typeId: number })[],
): Promise<Record<string, Record<string, string>>> {
  const tables: Record<string, Record<number, string>> = {};
  for (const { code, dir, encrypted } of GOOD_NAME_LOCALES) {
    let bytes: Uint8Array;
    try {
      bytes = await readSourceFile(roots, goodNamesPath(dir, encrypted));
    } catch {
      console.warn(`[pipeline] goods: name table for "${code}" missing; skipping that locale`);
      continue;
    }
    if (encrypted) {
      const sections = cifLinesToSections(decodeCifStringArray(bytes).lines);
      const raw = extractStringnById(sections);
      tables[code] = Object.fromEntries(
        Object.entries(raw).map(([id, text]) => [Number(id), latin1ToCp1250(text)]),
      );
    } else {
      tables[code] = extractStringnById(parseIniSections(decodeIni(bytes)));
    }
  }
  return resolveGoodNames(goods, tables);
}
