import { describe, expect, it } from 'vitest';
import { buildStringCif } from '../../formats/test/fixtures/cif.js';
import { resolveMapBriefing } from '../src/briefing.js';
import { loadMapStringTables, resolveMapMeta } from '../src/meta.js';
import { decodeMapText } from '../src/text.js';
import { testFolder } from './support/folder.js';

const latinBytes = (text: string) => Uint8Array.from(text, (char) => char.charCodeAt(0));
const LEGACY = [
  ['pol', 'WOLNO\x8c\xc6', 'WOLNOŚĆ'],
  ['ger', 'WOLNO\x8c\xc6', 'WOLNOŚĆ'],
  ['ger', '\xc4\xd6\xdc \xe4\xf6\xfc Stra\xdfe', 'ÄÖÜ äöü Straße'],
  ['eng', 'The Viking island', 'The Viking island'],
  ['rus', '\xcd\xce\xc2\xc0\xdf \xca\xc0\xd0\xd2\xc0', 'НОВАЯ КАРТА'],
  ['ita', 'Citt\xe0 e libert\xe0, per\xf2', 'Città e libertà, però'],
] as const;

describe('map text encodings', () => {
  it.each(LEGACY)('reads the %s slot consistently from plaintext and encrypted tables', (lang, raw, name) => {
    for (const form of ['ini', 'cif']) {
      const dir = testFolder();
      dir.write(
        `text/${lang}/strings.${form}`,
        form === 'ini'
          ? latinBytes(`[text]\nstring "${raw}"\n`)
          : buildStringCif([
              { level: 1, text: 'text' },
              { level: 2, text: `string "${raw}"` },
            ]),
      );
      expect(loadMapStringTables(dir.folder)[lang]?.[0]).toBe(name);
      expect(resolveMapMeta(dir.folder, undefined)?.name?.[lang]).toBe(name);
    }
  });

  it.each([
    ['pol', 'Ścieżka, łódź i źródło'],
    ['eng', 'King’s island: cœur'],
    ['ger', 'Überquerung, Bevölkerung und Straße'],
    ['rus', 'Новая карта'],
  ] as const)('reads UTF-8 metadata and briefing text in the %s slot', async (lang, text) => {
    const dir = testFolder();
    const utf8 = (value: string) => new TextEncoder().encode(value);
    dir.write(`text/${lang}/strings.ini`, utf8(`[text]\nstring "${text}"\n`));
    dir.write(`text/${lang}/briefings/briefings.txt`, utf8(`[blockstart:500]\n${text}\n[blockend:500]\n`));
    dir.write(`text/${lang}/briefings/0500.hlt`, utf8(`<include:$local$\\briefings.txt,500,1>\n${text}`));
    expect(resolveMapMeta(dir.folder, undefined)?.name?.[lang]).toBe(text);
    const briefing = await resolveMapBriefing(dir.folder, [500]);
    const blocks = briefing?.briefing.texts[lang]?.['500'];
    expect(
      blocks
        ?.filter((block) => block.kind === 'text')
        .map((block) => block.text)
        .join(' '),
    ).toBe(`${text}\n${text}`);
  });

  it('uses the same legacy Latin codepage for German-slot briefing bodies and page titles', async () => {
    const dir = testFolder();
    dir.write(
      'text/ger/briefings/briefings.txt',
      latinBytes('[blockstart:500]\n\xa3\xf3d\x9f\n[blockend:500]\n'),
    );
    dir.write(
      'text/ger/briefings/0500.hlt',
      latinBytes('<include:$local$\\briefings.txt,500,1>\nWOLNO\x8c\xc6'),
    );
    const briefing = await resolveMapBriefing(dir.folder, [500]);
    expect(
      briefing?.briefing.texts.ger?.['500']
        ?.filter((block) => block.kind === 'text')
        .map((block) => block.text),
    ).toEqual(['Łódź\nWOLNOŚĆ']);
  });

  it('falls back as a whole file when a legacy byte sequence is not valid UTF-8', () => {
    expect(decodeMapText(latinBytes('Bj\xf6rn i \xb3\xf3d\x9f'), 'ger')).toBe('Björn i łódź');
  });
});
