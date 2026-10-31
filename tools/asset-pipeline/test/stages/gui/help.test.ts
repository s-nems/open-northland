import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type FiledObjectTableOverlay,
  type Language,
  type ObjectTableOverlay,
  OVERLAY_VERSION,
  objectTableSourceDigest,
} from '@open-northland/data';
import type { TranslationOverlays } from '@open-northland/translations';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildStringCif } from '../../../../../packages/formats/test/fixtures/cif.js';
import { convertGuiObjectHelp, readObjectHelp } from '../../../src/stages/gui/help.js';
import { loadStringCorrections } from '../../../src/string-corrections.js';
import { type GameOutTemp, makeGameOutTemp } from '../../support/game-tree.js';

const helpFile = (lang: string, file: string): string => `Data/text/${lang}/strings/help/${file}`;

const readHelp = async (out: string, lang: string): Promise<unknown> =>
  JSON.parse(await readFile(join(out, 'gui', 'help', `${lang}.json`), 'utf8'));

describe('object help tables', () => {
  let temp: GameOutTemp;
  beforeEach(async () => {
    temp = await makeGameOutTemp('object-help');
  });
  afterEach(async () => {
    await temp.cleanup();
  });

  it('reads an ini by explicit and running ids, in its code page, with marked line breaks', async () => {
    const ini = [
      '[control]',
      'stringidmultiplier 1',
      '[text]',
      'stringn 3 "Glina "',
      'string "Gliny{newline}{newline}Kamie\xf1"',
      'stray words outside any string',
    ].join('\r\n');
    await temp.write(helpFile('pol', 'goodshelp.ini'), Buffer.from(ini, 'latin1'));

    await convertGuiObjectHelp({ data: temp.game }, temp.out, ['pol']);

    expect(await readHelp(temp.out, 'pol')).toEqual({
      goods: { 3: 'Glina', 4: 'Gliny\n\nKamień' },
      houses: {},
    });
  });

  it("reads a cif in its language's code page", async () => {
    const cif = buildStringCif([
      { level: 1, text: 'text' },
      { level: 2, text: 'stringn 2 "\xa8\xe6"' },
    ]);
    await temp.write(helpFile('rus', 'houseshelp.cif'), cif);

    await convertGuiObjectHelp({ data: temp.game }, temp.out, ['rus']);

    expect(await readHelp(temp.out, 'rus')).toEqual({ goods: {}, houses: { 2: 'Ёж' } });
  });

  it('applies a string correction under the help scope, not the name table', async () => {
    await temp.write(helpFile('pol', 'houseshelp.ini'), Buffer.from('[text]\nstringn 1 "stary tekst"\n'));
    const file = join(temp.root, 'tables.json');
    const entry = {
      lang: 'pol',
      table: 'housesHelp',
      id: 1,
      from: 'stary tekst',
      to: 'nowy',
      reason: 'test',
    };
    await writeFile(file, JSON.stringify([entry]));
    const stringCorrections = await loadStringCorrections(file);

    await convertGuiObjectHelp({ data: temp.game, stringCorrections }, temp.out, ['pol']);

    expect(await readHelp(temp.out, 'pol')).toEqual({ goods: {}, houses: { 1: 'nowy' } });
    expect(stringCorrections.unapplied()).toEqual([]);
  });

  it("writes an overlay language's file, with an edit only while its basis is the shipped table", async () => {
    await temp.write(helpFile('pol', 'goodshelp.ini'), Buffer.from('[text]\nstringn 1 "Drewno"\n'));
    await temp.write(helpFile('pol', 'houseshelp.ini'), Buffer.from('[text]\nstringn 2 "Tartak"\n'));
    const overlay = (lang: 'ger' | 'pol', digest: string, names: Record<string, string>) =>
      ({
        version: OVERLAY_VERSION,
        basis: { lang, digest },
        names,
        plurals: {},
      }) satisfies ObjectTableOverlay;
    const shipped = await readObjectHelp({ data: temp.game }, 'pol', 'goodsHelp');
    const objects = new Map<Language, ReadonlyMap<string, FiledObjectTableOverlay>>([
      [
        'chs',
        new Map([
          [
            'goodsHelp',
            {
              ...overlay('ger', '0'.repeat(64), { 1: '木头', 2: '石头' }),
              edit: overlay('pol', objectTableSourceDigest(shipped), { 2: '石料' }),
            },
          ],
          [
            'housesHelp',
            {
              ...overlay('ger', '0'.repeat(64), { 2: '锯木厂' }),
              edit: overlay('pol', '1'.repeat(64), { 2: '木工房' }),
            },
          ],
        ]),
      ],
      ['pol', new Map([['goodsHelp', overlay('pol', '0'.repeat(64), { 1: 'Refused' })]])],
    ]);
    const overlays: TranslationOverlays = {
      maps: new Map(),
      objects,
      names: new Map(),
      books: new Map(),
      campaigns: new Map(),
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const done = await convertGuiObjectHelp({ data: temp.game, overlays }, temp.out, []);

    expect(done.map(({ lang }) => lang)).toEqual(['chs']);
    expect(await readHelp(temp.out, 'chs')).toEqual({
      goods: { 1: '木头', 2: '石料' },
      houses: { 2: '锯木厂' },
    });
    expect(warn.mock.calls.flat()).toEqual([
      expect.stringContaining('chs housesHelp edit left out: its pol basis text changed'),
    ]);
    warn.mockRestore();
  });

  it('emits nothing for a language without help tables', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(convertGuiObjectHelp({ data: temp.game }, temp.out, ['chs'])).resolves.toEqual([]);

    await expect(readHelp(temp.out, 'chs')).rejects.toThrow();
    warn.mockRestore();
  });
});
