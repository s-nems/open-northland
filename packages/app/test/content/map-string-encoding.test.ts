import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MapStrings } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { contentDir, hasRealIr } from './helpers.js';

describe.runIf(hasRealIr())('generated map string encoding', () => {
  it('preserves Cyrillic in the owned corpus Russian map tables', () => {
    const root = resolve(contentDir(), 'maps');
    let russianTables = 0;
    let cyrillicTables = 0;
    for (const file of readdirSync(root).filter((name) => name.endsWith('.strings.json'))) {
      const tables = MapStrings.parse(JSON.parse(readFileSync(resolve(root, file), 'utf8')));
      if (tables.rus === undefined) continue;
      russianTables++;
      if (Object.values(tables.rus).some((text) => /\p{Script=Cyrillic}/u.test(text))) cyrillicTables++;
    }
    // Some mod maps put untranslated Latin text in rus; the shipped Russian corpus also has Cyrillic.
    if (russianTables > 0) expect(cyrillicTables).toBeGreaterThan(0);
  });
});
