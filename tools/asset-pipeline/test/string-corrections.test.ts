import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { convertGuiStrings } from '../src/stages/gui/strings.js';
import {
  loadStringCorrections,
  STRING_CORRECTIONS_FILE,
  type StringCorrection,
  type StringCorrections,
} from '../src/string-corrections.js';
import { buildStringCif } from './fixtures/cif.js';
import { type GameOutTemp, makeGameOutTemp } from './support/game-tree.js';

// Raw CP1251 bytes standing for 'Ёж', so the correction matches decoded text, not source bytes.
const RUS_SOURCE = '\xa8\xe6';
const RUS_TEXT = 'Ёж';
const GOOD_ID = 4;

const ENTRY: StringCorrection = {
  lang: 'rus',
  table: 'goods',
  id: GOOD_ID,
  from: RUS_TEXT,
  to: 'Ёжик',
  reason: 'test',
};

describe('string corrections', () => {
  let temp: GameOutTemp;
  let file: string;

  const writeEntries = (entries: unknown): Promise<void> => writeFile(file, JSON.stringify(entries));
  /** Converts the Russian tables through the corrections in `file`; the absent GUI tables only warn. */
  const convertRus = async (): Promise<{
    rus: Record<string, Record<string, string>>;
    corrections: StringCorrections;
  }> => {
    const corrections = await loadStringCorrections(file);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await convertGuiStrings({ mod: temp.game, stringCorrections: corrections }, temp.out, ['rus']);
    warn.mockRestore();
    const rus = JSON.parse(await readFile(join(temp.out, 'gui/strings/rus.json'), 'utf8'));
    return { rus, corrections };
  };

  beforeEach(async () => {
    temp = await makeGameOutTemp('string-corrections');
    file = join(temp.root, 'tables.json');
    await temp.write(
      'Data/text/rus/strings/gameobjects/goods.cif',
      buildStringCif([
        { level: 1, text: 'text' },
        { level: 2, text: `stringn ${GOOD_ID} "${RUS_SOURCE}"` },
        { level: 2, text: 'stringn 5 "other"' },
      ]),
    );
  });

  afterEach(() => temp.cleanup());

  it('replaces the decoded text that still reads "from" and leaves the rest of the table', async () => {
    await writeEntries([ENTRY]);
    const { rus, corrections } = await convertRus();
    expect(rus.goods).toEqual({ [GOOD_ID]: 'Ёжик', 5: 'other' });
    expect(() => corrections.assertApplied()).not.toThrow();
  });

  it('corrects a plural table like any other, matching the trimmed text', async () => {
    await temp.write(
      'Data/text/rus/strings/gameobjects/jobs.cif',
      buildStringCif([
        { level: 1, text: 'text' },
        { level: 2, text: `stringn ${GOOD_ID} "${RUS_SOURCE}"` },
        { level: 2, text: `string "${RUS_SOURCE}  ${RUS_SOURCE} "` },
      ]),
    );
    await writeEntries([{ ...ENTRY, table: 'jobsPlural', from: `${RUS_TEXT} ${RUS_TEXT}` }]);
    const { rus, corrections } = await convertRus();
    expect(rus.jobs).toEqual({ [GOOD_ID]: RUS_TEXT });
    expect(rus.jobsPlural).toEqual({ [GOOD_ID]: 'Ёжик' });
    expect(() => corrections.assertApplied()).not.toThrow();
  });

  it.each([
    ['the text changed', { ...ENTRY, from: 'Ёлка' }, /rus\/goods\/4 "Ёлка": the text is now "Ёж"/],
    ['the id is gone', { ...ENTRY, id: 9 }, /rus\/goods\/9 .*no such id/],
    ['the table is never decoded', { ...ENTRY, table: 'houses' }, /rus\/houses\/4 .*never read/],
  ])('fails the run when %s', async (_why, entry, message) => {
    await writeEntries([entry]);
    const { rus, corrections } = await convertRus();
    expect(rus.goods?.[GOOD_ID]).toBe(RUS_TEXT);
    expect(() => corrections.assertApplied()).toThrow(message);
  });

  it.each([
    ['an object instead of a list', { ...ENTRY }, /not a JSON array/],
    ['an unknown key', [{ ...ENTRY, sha256: 'x' }], /unknown key "sha256"/],
    ['a missing reason', [{ ...ENTRY, reason: ' ' }], /reason must say why/],
    ['a non-integer id', [{ ...ENTRY, id: '4' }], /id must be a string id/],
    ['a no-op swap', [{ ...ENTRY, to: RUS_TEXT }], /two different strings/],
    ['two entries for one string', [ENTRY, { ...ENTRY, to: 'Ёжики' }], /second entry for rus\/goods\/4/],
  ])('rejects %s', async (_why, entries, message) => {
    await writeEntries(entries);
    await expect(loadStringCorrections(file)).rejects.toThrow(message);
  });

  it('treats a missing file as no corrections', async () => {
    const none = await loadStringCorrections(join(temp.root, 'absent.json'));
    expect(none.list).toEqual([]);
    expect(() => none.assertApplied()).not.toThrow();
  });

  it('parses the committed corrections', async () => {
    expect((await loadStringCorrections(STRING_CORRECTIONS_FILE)).list.length).toBeGreaterThan(0);
  });
});
