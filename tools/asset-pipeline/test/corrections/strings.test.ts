import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildStringCif } from '../../../../packages/formats/test/fixtures/cif.js';
import { buildMapDat } from '../../../../packages/formats/test/fixtures/mapdat.js';
import { convertGuiStrings } from '../../src/stages/gui/strings.js';
import { convertMapDatTree } from '../../src/stages/maps/index.js';
import {
  loadMapStringCorrections,
  loadStringCorrections,
  MAP_STRING_CORRECTIONS_FILE,
  STRING_CORRECTIONS_FILE,
  type StringCorrections,
} from '../../src/string-corrections.js';
import { type GameOutTemp, makeGameOutTemp } from '../support/game-tree.js';

// Raw CP1251 bytes standing for 'Ёж', so the correction matches decoded text, not source bytes.
const RUS_SOURCE = '\xa8\xe6';
const RUS_TEXT = 'Ёж';
const GOOD_ID = 4;

const ENTRY = {
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
    await convertGuiStrings({ data: temp.game, stringCorrections: corrections }, temp.out, ['rus']);
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
    expect(corrections.unapplied().map(({ entry: { id } }) => id)).toEqual([entry.id]);
    expect(() => corrections.assertApplied()).toThrow(message);
  });

  it.each([
    ['an object instead of a list', { ...ENTRY }, /not a JSON array/],
    ['an unknown key', [{ ...ENTRY, sha256: 'x' }], /unknown key "sha256"/],
    ['an unknown language', [{ ...ENTRY, lang: 'ru' }], /lang must be one of eng, pol, ger, rus/],
    ['an unknown table', [{ ...ENTRY, table: 'good' }], /table must be one of main, .*jobsPlural/],
    ['a missing reason', [{ ...ENTRY, reason: ' ' }], /reason must say why/],
    ['a non-integer id', [{ ...ENTRY, id: '4' }], /id must be a string id/],
    ['a no-op swap', [{ ...ENTRY, to: RUS_TEXT }], /two different strings/],
    ['an addition to a GUI table', [{ ...ENTRY, from: null }], /two different strings/],
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

  it('parses the committed corrections, each naming a known language and table', async () => {
    expect((await loadStringCorrections(STRING_CORRECTIONS_FILE)).list.length).toBeGreaterThan(0);
  });
});

const MAP_ID = 'tutorial_002';
// The map description's default string id, so the meta sidecar shows whether it read the fix too.
const STRING_ID = 1;
const MAP_ENTRY = {
  map: MAP_ID,
  lang: 'pol',
  id: STRING_ID,
  from: 'Zbuduj ul.',
  to: 'Zbuduj dwa ule.',
  reason: 'test',
};

describe('help text corrections', () => {
  const ID = 3;
  const TEXT = 'Made from gold. Carried by men. Gold is rare.';
  const entry = (from: string, to: string) => ({
    lang: 'eng',
    table: 'goodsHelp',
    id: ID,
    from,
    to,
    reason: 'test',
  });
  let temp: GameOutTemp;

  const corrected = async (
    entries: unknown,
    text = TEXT,
  ): Promise<{ text: string | undefined; corrections: StringCorrections }> => {
    const file = join(temp.root, 'tables.json');
    await writeFile(file, JSON.stringify(entries));
    const corrections = await loadStringCorrections(file);
    return { text: corrections.correct('eng', 'goodsHelp', { [ID]: text })[ID], corrections };
  };

  beforeEach(async () => {
    temp = await makeGameOutTemp('help-corrections');
  });
  afterEach(() => temp.cleanup());

  it('replaces a phrase alone, and several entries for one id apply in file order', async () => {
    const { text, corrections } = await corrected([
      entry('from gold', 'from coins'),
      entry('coins. Carried', 'coins. Worn'),
      entry('Gold is rare.', ''),
    ]);
    expect(text).toBe('Made from coins. Worn by men. ');
    expect(() => corrections.assertApplied()).not.toThrow();
  });

  it('refuses a phrase that occurs twice, leaving the text alone', async () => {
    const { text, corrections } = await corrected([entry('old', 'new')]);
    expect(text).toBe(TEXT);
    expect(corrections.unapplied()[0]?.why).toContain('occurs 2 times');
    expect(() => corrections.assertApplied()).toThrow('occurs 2 times');
  });

  it('fails a missing phrase and keeps applying the entries after it', async () => {
    const { text, corrections } = await corrected([entry('silver', 'tin'), entry('Carried', 'Worn')]);
    expect(text).toBe('Made from gold. Worn by men. Gold is rare.');
    expect(corrections.unapplied().map(({ entry: e }) => e.from)).toEqual(['silver']);
  });

  it('rejects an empty phrase, and still matches any other table whole', async () => {
    await expect(corrected([entry('', 'x')])).rejects.toThrow('must name a phrase');
    const file = join(temp.root, 'tables.json');
    await writeFile(file, JSON.stringify([{ ...entry('gold', 'coins'), table: 'goods' }]));
    const corrections = await loadStringCorrections(file);
    expect(corrections.correct('eng', 'goods', { [ID]: TEXT })[ID]).toBe(TEXT);
    expect(corrections.unapplied()).toHaveLength(1);
  });
});

describe('map string corrections', () => {
  let temp: GameOutTemp;
  let file: string;

  /** Converts the map tree through the corrections in `file`. */
  const convertMaps = async (
    entries: unknown,
  ): Promise<{
    strings: Record<string, Record<string, string>>;
    corrections: StringCorrections;
  }> => {
    await writeFile(file, JSON.stringify(entries));
    const corrections = await loadMapStringCorrections(file);
    await convertMapDatTree({ data: temp.game, mapStringCorrections: corrections }, temp.out);
    const strings = JSON.parse(await readFile(join(temp.out, `maps/${MAP_ID}.strings.json`), 'utf8'));
    return { strings, corrections };
  };

  beforeEach(async () => {
    temp = await makeGameOutTemp('map-string-corrections');
    file = join(temp.root, 'maps.json');
    await temp.write(`maps/community/${MAP_ID}/map.dat`, buildMapDat(1, 1, [2, 2, 2, 2]));
    await temp.write(
      `maps/community/${MAP_ID}/text/pol/strings.cif`,
      buildStringCif([
        { level: 1, text: 'text' },
        { level: 2, text: `stringn ${STRING_ID} "Zbuduj ul."` },
        { level: 2, text: 'stringn 4 "Inne"' },
      ]),
    );
  });

  afterEach(() => temp.cleanup());

  it('replaces the decoded map string that still reads "from" before the meta reads it', async () => {
    const { strings, corrections } = await convertMaps([MAP_ENTRY]);
    expect(strings.pol).toEqual({ [STRING_ID]: 'Zbuduj dwa ule.', 4: 'Inne' });
    const meta = JSON.parse(await readFile(join(temp.out, `maps/${MAP_ID}.meta.json`), 'utf8'));
    expect(meta.description).toEqual({ pol: 'Zbuduj dwa ule.' });
    expect(() => corrections.assertApplied()).not.toThrow();
  });

  it('adds an absent map string before mission descriptions read it, without mutating the input table', async () => {
    await temp.write(
      `maps/community/${MAP_ID}/mission.inc`,
      Buffer.from('[MissionData]\ndebuginfo "home"\ndescription 5\nvisible 1\ngoal "HumansWithHome" 0 2\n'),
    );
    const { strings, corrections } = await convertMaps([{ ...MAP_ENTRY, id: 5, from: null }]);
    expect(strings.pol).toEqual({ 1: 'Zbuduj ul.', 4: 'Inne', 5: MAP_ENTRY.to });
    const script = JSON.parse(await readFile(join(temp.out, `maps/${MAP_ID}.script.json`), 'utf8'));
    expect(script.missions[0].description).toBe(MAP_ENTRY.to);
    expect(script.missions[0].goals[0].values).toEqual(['HumansWithHome', '0', '2']);
    const input = { 1: 'untouched' };
    expect(corrections.correct('pol', MAP_ID, input)).toEqual({ 1: 'untouched', 5: MAP_ENTRY.to });
    expect(input).toEqual({ 1: 'untouched' });
    expect(() => corrections.assertApplied()).not.toThrow();
  });

  it.each(['occupied', MAP_ENTRY.to])(
    'never overwrites an occupied id when adding a map string: %s',
    async (text) => {
      await writeFile(file, JSON.stringify([{ ...MAP_ENTRY, id: 5, from: null }]));
      const corrections = await loadMapStringCorrections(file);
      const input = { 5: text };
      expect(corrections.correct('pol', MAP_ID, input)).toEqual(input);
      expect(() => corrections.assertApplied()).toThrow(/the text is now/);
    },
  );

  it('does not invent a missing language table for a map-string addition', async () => {
    const { strings, corrections } = await convertMaps([{ ...MAP_ENTRY, lang: 'eng', id: 5, from: null }]);
    expect(strings.eng).toBeUndefined();
    expect(() => corrections.assertApplied()).toThrow(/never read/);
  });

  it.each([
    [
      'the text changed',
      { ...MAP_ENTRY, from: 'Zbuduj most.' },
      /pol\/tutorial_002\/1 .*the text is now "Zbuduj ul."/,
    ],
    ['the language is not shipped', { ...MAP_ENTRY, lang: 'eng' }, /eng\/tutorial_002\/1 .*never read/],
    ['the map is unknown', { ...MAP_ENTRY, map: 'tutorial_099' }, /pol\/tutorial_099\/1 .*never read/],
  ])('fails the run when %s', async (_why, entry, message) => {
    const { strings, corrections } = await convertMaps([entry]);
    expect(strings.pol?.[STRING_ID]).toBe('Zbuduj ul.');
    expect(() => corrections.assertApplied()).toThrow(message);
  });

  it('rejects a table key in a map entry', async () => {
    await writeFile(file, JSON.stringify([{ ...MAP_ENTRY, table: 'goods' }]));
    await expect(loadMapStringCorrections(file)).rejects.toThrow(/unknown key "table"/);
  });

  it('parses the committed map corrections', async () => {
    expect((await loadMapStringCorrections(MAP_STRING_CORRECTIONS_FILE)).list.length).toBeGreaterThan(0);
  });
});
