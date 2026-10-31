import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  MAP_OVERLAY_BASIS_PREFIX_LENGTH,
  mapOverlayDatKey,
  mapOverlayFileId,
  OVERLAY_VERSION,
} from '@open-northland/data';
import { mapSourceTextDigest } from '@open-northland/map-import';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildMapDat } from '../../../packages/formats/test/fixtures/mapdat.js';
import { auditTranslations } from '../src/audit.js';
import {
  bookSourceDigest,
  objectTableSourceDigest,
  type PackMap,
  type PackText,
  readPackText,
} from '../src/pack-text.js';

/**
 * `npm run check:translations`: the layout and schema of every overlay file, and with the unpacked pack
 * each overlay against the source text it was written for. All text is authored for these tests.
 */

const DIGEST = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);
const DAT_MD5 = 'f'.repeat(32);
/** The plain file names of the `fjord` overlays of `DIGEST` and `OTHER`. */
const FILE = mapOverlayFileId('fjord', DIGEST);
const OTHER_FILE = mapOverlayFileId('fjord', OTHER);

/** The file name of a further map overlay of `DIGEST` written against `basisDigest`. */
const variantOf = (basisDigest: string): string => mapOverlayFileId('fjord', DIGEST, basisDigest);

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'translations-audit-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function put(rel: string, value: unknown): Promise<void> {
  const path = join(dir, rel);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    typeof value === 'string' || value instanceof Uint8Array ? value : JSON.stringify(value),
  );
}

const basis = (digest = '0'.repeat(64), lang = 'pol') => ({ lang, digest });

const mapOverlay = (
  strings: Record<string, string>,
  briefings: Record<string, string> = {},
  base = basis(),
) => ({
  version: OVERLAY_VERSION,
  map: 'fjord',
  basis: base,
  strings,
  briefings,
});

describe('auditTranslations: layout and schema', () => {
  it('accepts the contract files and valid overlays of every kind', async () => {
    await put('AGENTS.md', '# contract');
    await put('SOURCES.md', '# sources');
    await put('glossary.csv', 'term');
    await put('glossary-project.csv', 'term');
    await put('.DS_Store', 'finder');
    await put(`chs/maps/${FILE}.json`, mapOverlay({ '0': '峡湾' }));
    await put(`eng/maps/${FILE}.json`, mapOverlay({ '0': 'Fjord' }));
    await put('chs/objects/goods.json', { version: OVERLAY_VERSION, basis: basis(), names: { '1': '木头' } });
    await put('chs/books/history.json', { version: OVERLAY_VERSION, basis: basis(), blocks: {} });
    await put('cht/campaigns/saga.json', { version: OVERLAY_VERSION, title: '傳奇' });

    const report = await auditTranslations(dir);

    expect(report).toEqual({ files: 5, errors: [], warnings: [], unmatchedMaps: 0 });
  });

  it('accepts a personal-name overlay per pool, and refuses one named, filed or placed for another', async () => {
    await put('chs/names/viking-male.json', {
      version: OVERLAY_VERSION,
      pool: 'viking-male',
      names: { Bjarni: '比亚尔尼' },
    });
    await put('chs/names/not-a-pool.json', { version: OVERLAY_VERSION, pool: 'not-a-pool', names: {} });
    await put('cht/names/frank-female.json', { version: OVERLAY_VERSION, pool: 'viking-female', names: {} });
    await put('eng/names/viking-male.json', { version: OVERLAY_VERSION, pool: 'viking-male', names: {} });

    const report = await auditTranslations(dir);

    expect(report.files).toBe(1);
    expect(report.errors).toEqual([
      {
        file: 'chs/names/not-a-pool.json',
        message: 'a names overlay is named by the personal-name pool it translates',
      },
      { file: 'cht/names/frank-female.json', message: 'names the pool viking-female, not frank-female' },
      {
        file: 'eng/names/viking-male.json',
        message: 'a source language overlays only community maps; its own text keeps corrections',
      },
    ]);
    expect(report.warnings).toEqual([]);
  });

  it('warns of a personal name the pool the overlay translates never generates', async () => {
    await put('chs/names/werewolf-neutral.json', {
      version: OVERLAY_VERSION,
      pool: 'werewolf-neutral',
      names: { Bjarni: '比亚尔尼', Garm: '加姆' },
    });

    const report = await auditTranslations(dir);

    expect(report.files).toBe(1);
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([
      {
        file: 'chs/names/werewolf-neutral.json',
        message: 'names the werewolf-neutral pool lacks: Bjarni, Garm',
      },
    ]);
  });

  it('accepts authored film subtitles in source and overlay languages beside campaign titles', async () => {
    await put('chs/campaigns/saga.json', { version: OVERLAY_VERSION, title: '傳奇' });
    for (const lang of ['eng', 'chs']) {
      for (const slot of ['intro', 'seq_0000']) {
        await put(`${lang}/campaigns/saga/films/${slot}.srt`, '1\n00:00:00,000 --> 00:00:01,000\nTest');
      }
    }
    expect(await auditTranslations(dir)).toEqual({
      files: 1,
      errors: [],
      warnings: [],
      unmatchedMaps: 0,
    });
  });

  it('rejects stray campaign files and directories without allowing source-language title overlays', async () => {
    await put('eng/campaigns/saga.json', { version: OVERLAY_VERSION, title: 'Saga' });
    await put('chs/campaigns/Saga One/films/intro.srt', 'text');
    await put('chs/campaigns/saga/notes.txt', 'text');
    await put('chs/campaigns/saga/films/intro.json', {});
    await put('chs/campaigns/saga/films/seq_1.srt', 'text');
    await put('chs/campaigns/saga/films/intro.srt/nested.txt', 'text');
    const { errors } = await auditTranslations(dir);
    expect(errors.map(({ file }) => file)).toEqual([
      'chs/campaigns/Saga One',
      'chs/campaigns/saga/films/intro.json',
      'chs/campaigns/saga/films/intro.srt',
      'chs/campaigns/saga/films/seq_1.srt',
      'chs/campaigns/saga/notes.txt',
      'eng/campaigns/saga.json',
    ]);
  });

  it('reports every layout and schema violation, each naming its file', async () => {
    await put('notes.txt', 'stray');
    await put(`xyz/maps/${FILE}.json`, mapOverlay({}));
    await put('chs/strings/main.json', {});
    await put('chs/maps/fjord.json', mapOverlay({}));
    await put(`chs/maps/${OTHER}.txt`, 'text');
    await put('chs/objects/weather.json', { version: OVERLAY_VERSION, basis: basis(), names: {} });
    await put('chs/books/sagas.json', { version: OVERLAY_VERSION, basis: basis(), blocks: {} });
    await put('chs/campaigns/Saga One.json', { version: OVERLAY_VERSION, title: 'x' });
    await put('pol/objects/goods.json', { version: OVERLAY_VERSION, basis: basis(), names: {} });
    await put(`cht/maps/${FILE}.json`, { ...mapOverlay({}), basis: basis('short') });

    const { errors, files } = await auditTranslations(dir);

    expect(files).toBe(0);
    expect(errors.map((finding) => finding.file)).toEqual([
      'chs/books/sagas.json',
      'chs/campaigns/Saga One.json',
      `chs/maps/${OTHER}.txt`,
      'chs/maps/fjord.json',
      'chs/objects/weather.json',
      'chs/strings',
      `cht/maps/${FILE}.json`,
      'notes.txt',
      'pol/objects/goods.json',
      'xyz/',
    ]);
    expect(errors.find((finding) => finding.file.startsWith('cht/'))?.message).toMatch(
      /^invalid maps overlay at basis\.digest/,
    );
    expect(errors.find((finding) => finding.file.startsWith('pol/'))?.message).toMatch(/community maps/);
  });
});

describe('auditTranslations: map overlays of one map.dat', () => {
  it('refuses a variant name its basis does not begin, and a second file of one basis', async () => {
    const shared = basis('c'.repeat(64));
    await put(`chs/maps/${FILE}.json`, mapOverlay({ '0': '峡湾' }, {}, shared));
    await put(`chs/maps/${variantOf(shared.digest)}.json`, mapOverlay({ '0': '峡湾' }, {}, shared));
    await put(`cht/maps/${variantOf('d'.repeat(64))}.json`, mapOverlay({ '0': '峽灣' }, {}, shared));
    await put(`cht/maps/${FILE}.json`, mapOverlay({ '0': '峽灣' }, {}, shared));

    const { errors, files } = await auditTranslations(dir);

    expect(files).toBe(2);
    expect(errors).toEqual([
      {
        file: `chs/maps/${FILE}.json`,
        message: `${variantOf(shared.digest)}.json has the same map.dat and basis.digest`,
      },
      {
        file: `cht/maps/${variantOf('d'.repeat(64))}.json`,
        message: `the name's basis prefix ${'d'.repeat(MAP_OVERLAY_BASIS_PREFIX_LENGTH)} does not begin basis.digest ${shared.digest}`,
      },
    ]);
  });
});

describe('auditTranslations: edits over imported overlays', () => {
  it('refuses an object table edit without the table it edits', async () => {
    await put('chs/objects/goods.edit.json', {
      version: OVERLAY_VERSION,
      basis: basis(),
      names: { '1': '木头' },
    });

    const { errors } = await auditTranslations(dir);

    expect(errors).toEqual([
      {
        file: 'chs/objects/goods.edit.json',
        message: 'an edit needs the overlay it edits beside it, goods.json',
      },
    ]);
  });
});

describe('auditTranslations: against the pack', () => {
  const strings = { 0: 'Fjord', 1: 'Opis' };
  const briefings = new Map([['title', 'Na polnoc']]);
  const polDigest = mapSourceTextDigest(strings, briefings);

  function packMap(fields: Partial<PackMap> & Pick<PackMap, 'folder'>): PackMap {
    return {
      id: 'fjord',
      takesSourceLanguages: true,
      datMd5: DAT_MD5,
      text: {
        datDigest: DIGEST,
        languages: { pol: { strings, briefings }, eng: { strings: {}, briefings: new Map() } },
      },
      ...fields,
    };
  }

  const goods = { names: { 1: 'Drewno' }, plurals: {} };
  const history = new Map([['history.txt', new Map([['00', 'Dawno temu']])]]);

  function pack(maps: readonly PackMap[]): PackText {
    return {
      maps: async () => new Map([[mapOverlayDatKey(DIGEST), maps]]),
      campaigns: new Set(['saga']),
      objectNames: async (lang, table) => {
        if (lang === 'pol' && table === 'goods') return goods;
        throw new Error(`Data/text/${lang}/strings/gameobjects/${table}.cif not found`);
      },
      historyBlocks: async (lang) => (lang === 'pol' ? history : undefined),
    };
  }

  it('lists stale bases, redundant languages and keys the source lacks as warnings only', async () => {
    await put(
      `chs/maps/${FILE}.json`,
      mapOverlay({ '0': '峡湾', '7': '多余' }, { title: '北', ending: '终' }, basis(polDigest)),
    );
    await put(`cht/maps/${FILE}.json`, mapOverlay({ '0': '峽灣' }));
    await put(`eng/maps/${FILE}.json`, mapOverlay({ '0': 'Fjord' }, {}, basis(polDigest)));
    await put(`chs/maps/${OTHER_FILE}.json`, mapOverlay({}));
    await put('chs/objects/goods.json', {
      version: OVERLAY_VERSION,
      basis: basis(objectTableSourceDigest(goods)),
      names: { '1': '木头', '9': '铁' },
    });
    await put('chs/objects/houses.json', { version: OVERLAY_VERSION, basis: basis(), names: {} });
    await put('chs/books/history.json', {
      version: OVERLAY_VERSION,
      basis: basis(bookSourceDigest(history)),
      blocks: { 'history.txt': { '00': '很久以前', '01': '后来' } },
    });
    await put('cht/books/history.json', { version: OVERLAY_VERSION, basis: basis(), blocks: {} });
    await put('chs/campaigns/saga.json', { version: OVERLAY_VERSION, title: '传奇' });
    await put('chs/campaigns/lost.json', { version: OVERLAY_VERSION, title: '失落' });

    const report = await auditTranslations(dir, pack([packMap({ folder: 'maps/community/fjord' })]));

    expect(report.errors).toEqual([]);
    expect(report.unmatchedMaps).toBe(1);
    expect(report.warnings).toEqual([
      { file: 'chs/books/history.json', message: 'history.txt labels the pol source lacks: 01' },
      { file: 'chs/campaigns/lost.json', message: 'the pack has no campaign lost' },
      {
        file: `chs/maps/${FILE}.json`,
        message: 'maps/community/fjord: string ids the pol source lacks: 7',
      },
      {
        file: `chs/maps/${FILE}.json`,
        message: 'maps/community/fjord: briefing labels the pol source lacks: ending',
      },
      { file: 'chs/objects/goods.json', message: 'type ids the pol source lacks: 9' },
      {
        file: 'chs/objects/houses.json',
        message: 'no readable pol houses table: Data/text/pol/strings/gameobjects/houses.cif not found',
      },
      { file: 'cht/books/history.json', message: 'the pol basis text changed' },
      { file: `cht/maps/${FILE}.json`, message: 'maps/community/fjord: the pol basis text changed' },
      {
        file: `eng/maps/${FILE}.json`,
        message: 'maps/community/fjord ships eng text itself, which wins; the overlay is redundant',
      },
    ]);
  });

  it('audits an edit against its basis text like an applied overlay, and leaves out a stale one', async () => {
    const older = basis('f'.repeat(64));
    await put(`chs/maps/${FILE}.json`, mapOverlay({ '0': '峡湾', '1': '描述' }, {}, older));
    await put(
      `pol/maps/${FILE}.json`,
      mapOverlay({ '0': 'Fjord polnocny', '1': 'Nowy opis' }, { title: 'Na polnoc, hen' }, basis(polDigest)),
    );
    await put(`chs/maps/${FILE}.edit.json`, mapOverlay({ '0': '北峡湾', '7': '多余' }, {}, basis(polDigest)));
    await put(`cht/maps/${FILE}.json`, mapOverlay({ '0': '峽灣' }, {}, older));
    await put(`cht/maps/${FILE}.edit.json`, mapOverlay({ '0': '北峽灣' }, {}, basis('e'.repeat(64))));

    const report = await auditTranslations(dir, pack([packMap({ folder: 'maps/community/fjord' })]));

    expect(report.errors).toEqual([]);
    expect(report.files).toBe(5);
    expect(report.unmatchedMaps).toBe(1);
    expect(report.warnings).toEqual([
      {
        file: `chs/maps/${FILE}.edit.json`,
        message: 'maps/community/fjord: string ids the pol source lacks: 7',
      },
      { file: `chs/maps/${FILE}.json`, message: 'maps/community/fjord: the pol basis text changed' },
      { file: `cht/maps/${FILE}.edit.json`, message: 'the pol basis text changed; the edit is left out' },
      { file: `cht/maps/${FILE}.json`, message: 'maps/community/fjord: the pol basis text changed' },
    ]);
  });

  it('warns about values still the source text, a skeleton nobody translated as a whole', async () => {
    const shipped = { 0: 'Fjord', 1: 'Opis', 2: '...' };
    const blocks = new Map([
      ['title', 'Na polnoc'],
      ['art', '<picture:fjord.bmp>'],
    ]);
    const shippedDigest = mapSourceTextDigest(shipped, blocks);
    const map = packMap({
      folder: 'maps/community/fjord',
      text: { datDigest: DIGEST, languages: { pol: { strings: shipped, briefings: blocks } } },
    });
    const skeleton = { '0': 'Fjord', '1': 'Opis', '2': '...' };
    const blockSkeleton = { title: 'Na polnoc', art: '<picture:fjord.bmp>' };
    await put(`chs/maps/${FILE}.json`, mapOverlay(skeleton, blockSkeleton, basis(shippedDigest)));
    await put(
      `cht/maps/${FILE}.json`,
      mapOverlay({ ...skeleton, '1': '描述' }, blockSkeleton, basis(shippedDigest)),
    );
    await put(
      `pol/maps/${FILE}.json`,
      mapOverlay({ '0': 'Fjord', '1': 'Nowy opis', '2': '...' }, {}, basis(shippedDigest)),
    );

    const { warnings } = await auditTranslations(dir, pack([map]));

    expect(warnings).toEqual([
      {
        file: `chs/maps/${FILE}.json`,
        message: 'maps/community/fjord: untranslated, every value is still the pol source text',
      },
      {
        file: `cht/maps/${FILE}.json`,
        message: 'maps/community/fjord: untranslated string ids, still the pol source text: 0',
      },
      {
        file: `cht/maps/${FILE}.json`,
        message: 'maps/community/fjord: untranslated briefing labels, still the pol source text: title',
      },
      {
        file: `pol/maps/${FILE}.json`,
        message: 'maps/community/fjord: unedited string ids, still the pol source text: 0',
      },
    ]);
  });

  it('warns about values that lose or change the goal prefix, placeholders or tags of their source', async () => {
    const shipped = { 0: '@Znajdz studnie', 1: 'Beczki %d/5', 2: 'Opis' };
    const blocks = new Map([
      ['title', '<picture:fjord.bmp>\nNa polnoc'],
      ['art', '<font:big>Fjord<font:normal>'],
    ]);
    const map = packMap({
      folder: 'maps/community/fjord',
      text: { datDigest: DIGEST, languages: { pol: { strings: shipped, briefings: blocks } } },
    });
    await put(
      `chs/maps/${FILE}.json`,
      mapOverlay(
        { '0': '找到水井', '1': '木桶 %s/5', '2': '描述' },
        { title: '<picture:other.bmp>\n向北', art: '<font:big>峡湾<font:normal>' },
        basis(mapSourceTextDigest(shipped, blocks)),
      ),
    );

    const { warnings } = await auditTranslations(dir, pack([map]));

    expect(warnings).toEqual([
      {
        file: `chs/maps/${FILE}.json`,
        message:
          'maps/community/fjord: string ids whose goal prefix or placeholders differ from the pol source: 0, 1',
      },
      {
        file: `chs/maps/${FILE}.json`,
        message: 'maps/community/fjord: briefing labels whose tags differ from the pol source: title',
      },
    ]);
  });

  it('warns about a source-language overlay on every copy of the map that refuses one', async () => {
    await put(`pol/maps/${FILE}.json`, mapOverlay({ '0': 'Fjord polnocny' }, {}, basis(polDigest)));
    const copies = [
      packMap({ folder: 'maps/community/fjord' }),
      packMap({ folder: 'campaigns/saga/saga_01', campaign: 'saga', takesSourceLanguages: false }),
    ];

    const { warnings } = await auditTranslations(dir, pack(copies));

    expect(warnings).toEqual([
      {
        file: `pol/maps/${FILE}.json`,
        message:
          'campaign map campaigns/saga/saga_01 takes no source-language overlay; the pipeline refuses it',
      },
    ]);
  });
});

describe('auditTranslations: copies of one map.dat with other text', () => {
  const briefings = new Map([['title', 'Na polnoc']]);
  const texts = {
    fjord: { 0: 'Fjord', 1: 'Opis' },
    twin: { 0: 'Fjord drugi', 1: 'Opis' },
    third: { 0: 'Fjord trzeci', 1: 'Opis' },
  } as const;
  const basisOf = (name: keyof typeof texts) => basis(mapSourceTextDigest(texts[name], briefings));

  function copiesOf(...names: (keyof typeof texts)[]): PackText {
    const copies = names.map(
      (name): PackMap => ({
        folder: `maps/community/${name}`,
        id: name,
        takesSourceLanguages: true,
        datMd5: DAT_MD5,
        text: { datDigest: DIGEST, languages: { pol: { strings: texts[name], briefings } } },
      }),
    );
    return {
      maps: async () => new Map([[mapOverlayDatKey(DIGEST), copies]]),
      campaigns: new Set(),
      objectNames: async () => {
        throw new Error('no object tables');
      },
      historyBlocks: async () => undefined,
    };
  }

  it('takes for each copy the overlay written against its own text, and warns about none', async () => {
    await put(`chs/maps/${FILE}.json`, mapOverlay({ '0': '峡湾' }, {}, basisOf('fjord')));
    const twin = basisOf('twin');
    await put(`chs/maps/${variantOf(twin.digest)}.json`, mapOverlay({ '0': '第二峡湾' }, {}, twin));

    const report = await auditTranslations(dir, copiesOf('fjord', 'twin'));

    expect(report).toEqual({ files: 2, errors: [], warnings: [], unmatchedMaps: 0 });
  });

  it('names the copy that shares a file written against its twin', async () => {
    await put(`chs/maps/${FILE}.json`, mapOverlay({ '0': '峡湾' }, {}, basisOf('fjord')));

    const { warnings } = await auditTranslations(dir, copiesOf('fjord', 'twin'));

    expect(warnings).toEqual([
      {
        file: `chs/maps/${FILE}.json`,
        message:
          "maps/community/twin: its pol text differs from maps/community/fjord's, which the overlay was " +
          'written against; a variant file gives it its own',
      },
    ]);
  });

  it('applies an edit only to the copy whose text it was written against, without a stale fallback', async () => {
    await put(`pol/maps/${FILE}.json`, mapOverlay({ '0': 'Fjord polnocny' }, {}, basisOf('fjord')));

    const report = await auditTranslations(dir, copiesOf('fjord', 'twin'));

    expect(report.unmatchedMaps).toBe(0);
    expect(report.warnings).toEqual([
      {
        file: `pol/maps/${FILE}.json`,
        message:
          "maps/community/twin: not applied, its pol text differs from maps/community/fjord's, which the " +
          'edit was written against',
      },
    ]);
  });

  it('counts an edit whose basis text changed as taken by no map', async () => {
    await put(`pol/maps/${FILE}.json`, mapOverlay({ '0': 'Fjord polnocny' }, {}, basis('e'.repeat(64))));

    const report = await auditTranslations(dir, copiesOf('fjord'));

    expect(report.unmatchedMaps).toBe(1);
    expect(report.warnings).toEqual([
      {
        file: `pol/maps/${FILE}.json`,
        message:
          'maps/community/fjord: not applied, its pol basis text differs from the one the edit was written against',
      },
    ]);
  });

  it('warns about a copy none of several overlays was written for, and counts those no copy takes', async () => {
    const twin = basisOf('twin');
    const lost = basis('e'.repeat(64));
    await put(`chs/maps/${FILE}.json`, mapOverlay({ '0': '峡湾' }, {}, basisOf('fjord')));
    await put(`chs/maps/${variantOf(twin.digest)}.json`, mapOverlay({ '0': '第二峡湾' }, {}, twin));
    await put(`chs/maps/${variantOf(lost.digest)}.json`, mapOverlay({ '0': '失落' }, {}, lost));

    const { warnings, unmatchedMaps } = await auditTranslations(dir, copiesOf('fjord', 'twin', 'third'));

    const files = [variantOf(twin.digest), variantOf(lost.digest), FILE]
      .map((name) => `chs/maps/${name}.json`)
      .sort();
    expect(unmatchedMaps).toBe(1);
    expect(warnings).toEqual([
      {
        file: files[0],
        message:
          'maps/community/third takes none of the 3 chs overlays of its map.dat: its text matches the ' +
          `basis of none of ${files.join(', ')}`,
      },
    ]);
  });
});

describe('readPackText', () => {
  it('reads the maps, object tables and history book as the pack shipped them', async () => {
    const dat = buildMapDat(1, 1, [2, 2, 2, 2]);
    const manifest = {
      format: 'open-northland-data',
      version: 4,
      base: 'base',
      components: [{ id: 'base', kind: 'base', sha256: '0'.repeat(64) }],
      campaigns: [],
      files: [],
    };
    await put('pack/manifest.json', manifest);
    await put('pack/base/maps/community/Fjord/map.dat', dat);
    await put('pack/base/maps/community/Fjord/text/pol/strings.ini', '[text]\nstring "Fjord"\n');
    await put(
      'pack/base/maps/community/Fjord/text/pol/briefings/briefings.txt',
      '[blockstart:b]\nTekst\n[blockend:b]\n',
    );
    await put('pack/base/maps/community/Fjord/text/pol/briefings/0000.hlt', 'page');
    await put('pack/base/Data/maps/Loose/map.dat', buildMapDat(1, 1, [3, 3, 3, 3]));
    await put(
      'pack/base/Data/text/pol/strings/gameobjects/goods.ini',
      '[text]\nstringn 1 " Drewno "\nstring "Drewna"\n',
    );
    await put(
      'pack/base/Data/text/pol/hypertext/history/History.txt',
      '[blockstart:00]\nDawno\n[blockend:00]\n',
    );

    const pack = await readPackText(join(dir, 'pack'));
    const maps = await pack.maps();

    const digest = createHash('sha256').update(dat).digest('hex');
    const [fjord] = maps.get(mapOverlayDatKey(digest)) ?? [];
    expect(fjord?.folder).toBe('maps/community/fjord');
    expect(fjord?.id).toBe('fjord');
    expect(fjord?.datMd5).toBe(createHash('md5').update(dat).digest('hex'));
    expect(fjord?.takesSourceLanguages).toBe(true);
    expect(fjord?.text.languages.pol?.strings).toEqual({ 0: 'Fjord' });
    expect([...(fjord?.text.languages.pol?.briefings.keys() ?? [])]).toEqual(['b']);
    expect(
      [...maps.values()].flat().find((map) => map.folder === 'data/maps/loose')?.takesSourceLanguages,
    ).toBe(false);
    expect(await pack.objectNames('pol', 'goods')).toEqual({
      names: { 1: ' Drewno ' },
      plurals: { 1: 'Drewna' },
    });
    await expect(pack.objectNames('eng', 'goods')).rejects.toThrow(/goods\.cif not found/);
    expect(bookSourceDigest((await pack.historyBlocks('pol')) ?? new Map())).toBe(
      bookSourceDigest(new Map([['history.txt', new Map([['00', 'Dawno']])]])),
    );
    expect(await pack.historyBlocks('eng')).toBeUndefined();
  });
});
