import { join } from 'node:path';
import {
  cifBytesToSections,
  extractStringnById,
  iniBytesToSections,
  latin1ToCp1250,
} from '../../decoders/ini.js';
import type { SourceRoots } from '../../roots.js';
import { readSourceFile } from '../source-files.js';
import type { GoodLike } from './icons.js';

/**
 * The locales whose good-name table is extracted, most-preferred first, from
 * `text/<dir>/strings/gameobjects/goods.{ini,cif}`. The mod ships Polish as a plaintext `.ini` and English
 * as an encrypted `.cif`.
 */
const GOOD_NAME_LOCALES = [
  { code: 'pl', dir: 'pol', encrypted: false },
  { code: 'en', dir: 'eng', encrypted: true },
] as const;

function goodNamesPath(dir: string, encrypted: boolean): string {
  return join('Data', 'text', dir, 'strings', 'gameobjects', encrypted ? 'goods.cif' : 'goods.ini');
}

/**
 * Join the localized good-name string tables onto the goods by `typeId`, producing
 * `locale → (good string id → name)`. A good or locale absent from a table simply gets no entry.
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
      const raw = extractStringnById(cifBytesToSections(bytes));
      tables[code] = Object.fromEntries(
        Object.entries(raw).map(([id, text]) => [Number(id), latin1ToCp1250(text)]),
      );
    } else {
      tables[code] = extractStringnById(iniBytesToSections(bytes));
    }
  }
  return resolveGoodNames(goods, tables);
}
