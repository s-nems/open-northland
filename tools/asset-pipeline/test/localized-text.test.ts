import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadGoodNames } from '../src/stages/goods/names.js';
import { convertGuiHistory } from '../src/stages/gui/history.js';
import { convertGuiStrings, STRING_TABLES } from '../src/stages/gui/strings.js';
import { resolveMapBriefing } from '../src/stages/maps/briefing.js';
import { loadMapStringTables } from '../src/stages/maps/meta.js';
import { buildStringCif } from './fixtures/cif.js';
import { type GameOutTemp, makeGameOutTemp } from './support/game-tree.js';

// Authored display text, represented as source bytes rather than UTF-8 fixtures.
const TEXTS = [
  { lang: 'ger', code: 'de', bytes: 'Gr\xf6\xdfe \x9c', text: 'Größe œ' },
  { lang: 'rus', code: 'ru', bytes: '\xa8\xe6', text: 'Ёж' },
] as const;
const bytes = (text: string): Uint8Array => Buffer.from(text, 'latin1');

function table(text: string): Uint8Array {
  return buildStringCif([
    { level: 1, text: 'control' },
    { level: 2, text: 'stringidmultiplier 2' },
    { level: 1, text: 'text' },
    { level: 2, text: `stringn 5 "${text}"` },
    { level: 2, text: 'string "fixture plural"' },
  ]);
}

describe('localized pipeline text', () => {
  let temp: GameOutTemp;
  beforeEach(async () => {
    temp = await makeGameOutTemp('localized-text');
  });
  afterEach(async () => {
    await temp.cleanup();
  });

  it('exports German and Russian GUI tables by default in their own code pages', async () => {
    for (const { lang, bytes: raw } of TEXTS) {
      for (const name of STRING_TABLES) {
        await temp.write(`Data/text/${lang}/strings/ingamegui/ingamegui${name}.cif`, table(raw));
      }
    }
    // Supply the other default languages so an absent fixture does not produce skip warnings.
    for (const lang of ['pol', 'eng']) {
      for (const name of STRING_TABLES) {
        await temp.write(`Data/text/${lang}/strings/ingamegui/ingamegui${name}.cif`, table('fixture'));
      }
    }
    const result = await convertGuiStrings({ mod: temp.game }, temp.out);
    expect(result.map((r) => r.lang)).toEqual(['eng', 'pol', 'ger', 'rus']);
    for (const { lang, text } of TEXTS) {
      const output = JSON.parse(await readFile(join(temp.out, `gui/strings/${lang}.json`), 'utf8'));
      expect(output.misclogic['10']).toBe(text);
      expect(output.misclogic['12']).toBe('fixture plural');
    }
  });

  it('joins localized goods by explicit type id, without using the plural row', async () => {
    for (const { lang, bytes: raw } of TEXTS) {
      await temp.write(`Data/text/${lang}/strings/gameobjects/goods.cif`, table(raw));
    }
    await temp.write('Data/text/eng/strings/gameobjects/goods.cif', table('fixture'));
    await temp.write('Data/text/pol/strings/gameobjects/goods.ini', bytes('[text]\nstringn 5 "fixture"'));
    const names = await loadGoodNames({ mod: temp.game }, [{ id: 'fixture_good', typeId: 5 }]);
    expect(names.de?.fixture_good).toBe('Größe œ');
    expect(names.ru?.fixture_good).toBe('Ёж');
  });

  it.each(TEXTS)(
    'decodes $lang map tables, briefing includes and history pages',
    async ({ lang, bytes: raw, text }) => {
      await temp.write(`text/${lang}/strings.ini`, bytes(`[text]\nstringn 1 "${raw}"`));
      expect((await loadMapStringTables(temp.game, 'fixture'))[lang]?.[1]).toBe(text);

      const blocks = `[blockstart:${raw}]\n${raw}\n[blockend:${raw}]`;
      const page = `<include:$local$\\briefings.txt,${raw},1>\n${raw}`;
      await temp.write(`text/${lang}/briefings/briefings.txt`, bytes(blocks));
      await temp.write(`text/${lang}/briefings/0500.hlt`, bytes(page));
      const briefing = await resolveMapBriefing(temp.game, temp.out, 'fixture', [500]);
      expect(briefing?.texts[lang]?.['500']).toEqual([
        { kind: 'text', style: 'body', text: `${text}\n${text}` },
      ]);

      await temp.write(`Data/text/${lang}/hypertext/history/briefings.txt`, bytes(blocks));
      await temp.write(`Data/text/${lang}/hypertext/history/index.hlt`, bytes(page));
      const result = await convertGuiHistory({ mod: temp.game }, temp.out);
      expect(result.map((r) => r.lang)).toEqual([lang]);
      const book = JSON.parse(await readFile(join(temp.out, `gui/history/${lang}.json`), 'utf8'));
      expect(book.pages.index).toEqual([{ kind: 'text', style: 'body', text: `${text}\n${text}` }]);
    },
  );
});
