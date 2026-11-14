import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type BookOverlay,
  type CampaignOverlay,
  type FiledObjectTableOverlay,
  type Language,
  MapBriefing,
  type MapOverlay,
  MapStrings,
  mapOverlayDatKey,
  type ObjectTableOverlay,
  OVERLAY_VERSION,
  objectTableSourceDigest,
} from '@open-northland/data';
import { parseBriefingBlocks } from '@open-northland/formats/hypertext';
import { mapSourceTextDigest } from '@open-northland/map-import';
import type { TranslationOverlays } from '@open-northland/translations';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildStringCif } from '../../../../packages/formats/test/fixtures/cif.js';
import { buildMapDat } from '../../../../packages/formats/test/fixtures/mapdat.js';
import type { CampaignSource } from '../../../../scripts/data-pack.mjs';
import { loadSourceCorrections } from '../../src/corrections.js';
import { writeFileWithParents } from '../../src/files.js';
import type { SourceRoots } from '../../src/roots.js';
import { campaignMapId, convertCampaignStage } from '../../src/stages/campaigns.js';
import { convertGuiHistory, convertGuiObjectHelp, convertGuiStrings } from '../../src/stages/gui/index.js';
import { readGameObjectNames } from '../../src/stages/gui/strings.js';
import { convertMapDatTree, summarizeMapOverlays } from '../../src/stages/maps/index.js';
import { type GameOutTemp, makeGameOutTemp } from '../support/game-tree.js';

/**
 * The translation overlays as the pipeline stages apply them: map overlays by `map.dat` digest per map
 * provenance, object tables and the history book for overlay languages, and a campaign's languages and
 * title. All text is authored for these tests.
 */

const BASIS = { lang: 'pol', digest: '0'.repeat(64) } as const;

function overlays(parts: Partial<TranslationOverlays> = {}): TranslationOverlays {
  return {
    maps: new Map(),
    objects: new Map(),
    books: new Map(),
    campaigns: new Map(),
    names: new Map(),
    ...parts,
  };
}

function mapOverlay(strings: Record<string, string>, basis: MapOverlay['basis'] = BASIS): MapOverlay {
  return { version: OVERLAY_VERSION, map: 'test', basis, strings, briefings: {} };
}

function digestOf(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);
/** One byte per character, as a Windows code page file stores Latin-1 range text. */
const latinBytes = (text: string): Uint8Array => Uint8Array.from(text, (char) => char.charCodeAt(0));

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8'));
}

let temp: GameOutTemp;
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  temp = await makeGameOutTemp('translation-overlays');
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(async () => {
  warn.mockRestore();
  await temp.cleanup();
});

const warnings = (): string[] => warn.mock.calls.map((call: unknown[]) => String(call[0]));

describe('base maps stage', () => {
  it('takes a source-language overlay on a community map only, and an overlay language anywhere', async () => {
    const community = buildMapDat(2, 1, [3, 3, 6, 6, 3, 3, 6, 6]);
    const loose = buildMapDat(1, 1, [2, 2, 2, 2]);
    await temp.write('maps/community/fjord/map.dat', community);
    await temp.write('maps/community/fjord/text/pol/strings.ini', utf8('[text]\nstring "Fjord"\n'));
    await temp.write('Data/maps/loose/map.dat', loose);
    await temp.write('Data/maps/loose/text/pol/strings.ini', utf8('[text]\nstring "Luzna"\n'));
    const both = (name: string) =>
      new Map<Language, readonly MapOverlay[]>([
        ['eng', [mapOverlay({ '0': name })]],
        ['chs', [mapOverlay({ '0': '峡湾' })]],
      ]);
    const roots: SourceRoots = {
      data: temp.game,
      overlays: overlays({
        maps: new Map([
          [mapOverlayDatKey(digestOf(community)), both('Fjord')],
          [mapOverlayDatKey(digestOf(loose)), both('Loose')],
          [mapOverlayDatKey('f'.repeat(64)), both('Elsewhere')],
        ]),
      }),
    };

    const done = await convertMapDatTree(roots, temp.out);

    const strings = async (id: string) =>
      MapStrings.parse(await readJson(join(temp.out, 'maps', `${id}.strings.json`)));
    expect(await strings('fjord')).toEqual({
      pol: { '0': 'Fjord' },
      eng: { '0': 'Fjord' },
      chs: { '0': '峡湾' },
    });
    expect(await strings('loose')).toEqual({ pol: { '0': 'Luzna' }, chs: { '0': '峡湾' } });
    expect(done.find((map) => map.id === 'loose')?.overlays).toEqual([
      { lang: 'eng', status: 'refused' },
      { lang: 'chs', status: 'applied', stale: true },
    ]);
    expect(summarizeMapOverlays(done, new Set(roots.overlays?.maps.keys()))).toBe(
      'map overlays applied eng:1 chs:2, 0 redundant, 1 refused, 0 ambiguous, 0 edits outdated, 3 stale, ' +
        '1 filed for no map of this pack',
    );
  });
});

describe('base maps stage, an edit of a community map', () => {
  const folder = 'maps/community/samouczek';
  const briefings = `${folder}/text/pol/briefings/briefings.txt`;
  const page = '<include:$local$\\briefings.txt,title,1>\n<include:$local$\\briefings.txt,body,1>\n';
  // A typo in the title, and a body block opened twice whose second marker would show as text.
  const shipped =
    '[blockstart:title]\nSamouczk\n[blockend:title]\n' +
    '[blockstart:body]\n[blockstart:body]\nZbuduj farme.\n[blockend:body]\n';
  const shippedStrings = { 0: 'Samouczk', 1: 'Zbuduj farme.' };

  it('takes the text edit from the overlay and the marker repair from the correction', async () => {
    const dat = buildMapDat(1, 1, [2, 2, 2, 2]);
    await temp.write(`${folder}/map.dat`, dat);
    await temp.write(
      `${folder}/mission.inc`,
      utf8('[MissionData]\ndebuginfo "Briefing"\nresult "PlayCutscene" 0 1\n'),
    );
    await temp.write(
      `${folder}/text/pol/strings.ini`,
      utf8('[text]\nstring "Samouczk"\nstring "Zbuduj farme."\n'),
    );
    await temp.write(`${folder}/text/pol/briefings/0000.hlt`, utf8(page));
    await temp.write(briefings, utf8(shipped));
    const correctionsDir = join(temp.out, '..', 'corrections');
    const repeatedMarker = { line: 5, from: '[blockstart:body]', to: [] };
    await writeFileWithParents(
      join(correctionsDir, 'samouczek-briefing-pol.json'),
      utf8(
        JSON.stringify({
          reason: 'test',
          file: briefings,
          sha256: digestOf(utf8(shipped)),
          lines: [repeatedMarker],
        }),
      ),
    );
    const edit: MapOverlay = {
      version: OVERLAY_VERSION,
      map: 'samouczek',
      basis: { lang: 'pol', digest: mapSourceTextDigest(shippedStrings, parseBriefingBlocks(shipped)) },
      strings: { '0': 'Samouczek' },
      briefings: { title: 'Samouczek' },
    };
    const corrections = await loadSourceCorrections(correctionsDir, temp.game);
    const roots: SourceRoots = {
      data: temp.game,
      corrections,
      overlays: overlays({
        maps: new Map([
          [mapOverlayDatKey(digestOf(dat)), new Map<Language, readonly MapOverlay[]>([['pol', [edit]]])],
        ]),
      }),
    };

    const [map] = await convertMapDatTree(roots, temp.out);

    corrections.assertApplied();
    expect(map?.overlays).toEqual([{ lang: 'pol', status: 'applied', stale: false }]);
    const strings = MapStrings.parse(await readJson(join(temp.out, 'maps', 'samouczek.strings.json')));
    expect(strings).toEqual({ pol: { '0': 'Samouczek', '1': 'Zbuduj farme.' } });
    const briefing = MapBriefing.parse(await readJson(join(temp.out, 'maps', 'samouczek.briefing.json')));
    const text = (briefing.texts.pol?.['0'] ?? []).flatMap((block) =>
      block.kind === 'text' ? [block.text] : [],
    );
    expect(text).toEqual(['Samouczek\nZbuduj farme.']);
  });
});

describe('gui strings stage', () => {
  const table = (
    names: Record<string, string>,
    plurals: Record<string, string> = {},
  ): ObjectTableOverlay => ({
    version: OVERLAY_VERSION,
    basis: BASIS,
    names,
    plurals,
  });

  it("writes an overlay language's object tables, normalised, with the jobs plurals", async () => {
    const roots: SourceRoots = {
      data: temp.game,
      overlays: overlays({
        objects: new Map<Language, ReadonlyMap<string, ObjectTableOverlay>>([
          [
            'chs',
            new Map([
              ['goods', table({ '1': ' 木头 ' }, { '1': '木头们' })],
              ['goodsHelp', table({ '1': '木头的说明' })],
              ['jobs', table({ '2': '樵夫' }, { '2': '樵夫们' })],
              ['weather', table({ '1': '雨' })],
            ]),
          ],
          ['pol', new Map([['goods', table({ '1': 'Drewno' })]])],
        ]),
      }),
    };

    const done = await convertGuiStrings(roots, temp.out, []);

    expect(done).toEqual([{ lang: 'chs', path: 'gui/strings/chs.json', tables: 3, strings: 3 }]);
    expect(await readJson(join(temp.out, 'gui', 'strings', 'chs.json'))).toEqual({
      goods: { '1': '木头' },
      jobs: { '2': '樵夫' },
      jobsPlural: { '2': '樵夫们' },
    });
    expect(warnings()).toEqual([
      expect.stringContaining('ignored chs object-table overlay weather'),
      expect.stringContaining('refused pol object-table overlays'),
    ]);
  });

  it('applies an object table edit whose basis is the shipped table, and leaves out one whose basis changed', async () => {
    await temp.write(
      'Data/text/pol/strings/gameobjects/goods.ini',
      utf8('[text]\nstringn 1 "Drewno"\nstringn 2 "Kamien"\n'),
    );
    await temp.write('Data/text/pol/strings/gameobjects/jobs.ini', utf8('[text]\nstringn 2 "Drwal"\n'));
    const shipped = await readGameObjectNames({ data: temp.game }, 'pol', 'goods');
    const edit = (names: Record<string, string>, digest: string): ObjectTableOverlay => ({
      version: OVERLAY_VERSION,
      basis: { lang: 'pol', digest },
      names,
      plurals: {},
    });
    const roots: SourceRoots = {
      data: temp.game,
      overlays: overlays({
        objects: new Map<Language, ReadonlyMap<string, FiledObjectTableOverlay>>([
          [
            'chs',
            new Map([
              [
                'goods',
                {
                  ...table({ '1': '木头', '2': '石头' }),
                  edit: edit({ '2': '石料' }, objectTableSourceDigest(shipped)),
                },
              ],
              ['jobs', { ...table({ '2': '樵夫' }), edit: edit({ '2': '伐木工' }, '1'.repeat(64)) }],
            ]),
          ],
        ]),
      }),
    };

    await convertGuiStrings(roots, temp.out, []);

    expect(await readJson(join(temp.out, 'gui', 'strings', 'chs.json'))).toEqual({
      goods: { '1': '木头', '2': '石料' },
      jobs: { '2': '樵夫' },
      jobsPlural: {},
    });
    expect(warnings()).toEqual([
      expect.stringContaining('chs jobs edit left out: its pol basis text changed'),
    ]);
  });
  it("fills only the ids a pack-shipped overlay language's own tables lack", async () => {
    await temp.write(
      'Data/text/ita/strings/gameobjects/houses.ini',
      latinBytes('[text]\nstringn 1 "Citt\xe0"\nstringn 2 "Casa"\n'),
    );
    await temp.write(
      'Data/text/ita/strings/ingamegui/ingameguimain.ini',
      latinBytes('[text]\nstring "Gi\xf9"\n'),
    );
    const roots: SourceRoots = {
      data: temp.game,
      overlays: overlays({
        objects: new Map<Language, ReadonlyMap<string, ObjectTableOverlay>>([
          ['ita', new Map([['houses', table({ '2': 'Dimora', '22': 'Mura' })]])],
        ]),
      }),
    };

    const done = await convertGuiStrings(roots, temp.out, ['ita']);

    expect(done).toEqual([{ lang: 'ita', path: 'gui/strings/ita.json', tables: 2, strings: 4 }]);
    expect(await readJson(join(temp.out, 'gui', 'strings', 'ita.json'))).toEqual({
      main: { '0': 'Giù' },
      houses: { '1': 'Città', '2': 'Casa', '22': 'Mura' },
    });
    expect(warnings()).toEqual(
      expect.arrayContaining([
        expect.stringContaining('ita houses overlay ids the pack ships, kept shipped: 2'),
      ]),
    );
  });

  it("fills only the description ids a pack-shipped overlay language's own help lacks", async () => {
    await temp.write(
      'Data/text/ita/strings/help/goodshelp.ini',
      latinBytes('[text]\nstringn 1 "Legno{newline}secco"\n'),
    );
    const roots: SourceRoots = {
      data: temp.game,
      overlays: overlays({
        objects: new Map<Language, ReadonlyMap<string, ObjectTableOverlay>>([
          ['ita', new Map([['goodsHelp', table({ '1': 'Altro legno', '47': 'Faro' })]])],
        ]),
      }),
    };

    const done = await convertGuiObjectHelp(roots, temp.out, ['ita']);

    expect(done).toEqual([{ lang: 'ita', path: 'gui/help/ita.json', strings: 2 }]);
    expect(await readJson(join(temp.out, 'gui', 'help', 'ita.json'))).toEqual({
      goods: { '1': 'Legno\nsecco', '47': 'Faro' },
      houses: {},
    });
  });
});

describe('gui history stage', () => {
  const book = (
    blocks: BookOverlay['blocks'],
    basis: BookOverlay['basis'] = { ...BASIS, lang: 'eng' },
  ): BookOverlay => ({
    version: OVERLAY_VERSION,
    basis,
    blocks,
  });

  it("renders an overlay language from the basis language's pages with the overlay's blocks", async () => {
    const dir = join('Data', 'text', 'eng', 'hypertext', 'history');
    await temp.write(
      join(dir, 'Book.txt'),
      utf8('[blockstart:title]\nSAGAS\n[blockend:title]\n[blockstart:body]\nOld tales\n[blockend:body]\n'),
    );
    await temp.write(
      join(dir, 'index.hlt'),
      utf8('<include:$local$\\Book.txt,title,1>\n\\n\n<include:$local$\\Book.txt,body,1>\n'),
    );
    const roots: SourceRoots = {
      data: temp.game,
      overlays: overlays({
        books: new Map<Language, ReadonlyMap<string, BookOverlay>>([
          ['chs', new Map([['history', book({ 'book.txt': { body: '古老的故事' } })]])],
          ['ger', new Map([['history', book({ 'book.txt': { body: 'Alte Sagen' } })]])],
        ]),
      }),
    };

    const done = await convertGuiHistory(roots, temp.out, ['eng']);

    expect(done.map((result) => result.lang)).toEqual(['eng', 'chs']);
    const texts = async (lang: string) => {
      const { pages } = (await readJson(join(temp.out, 'gui', 'history', `${lang}.json`))) as {
        pages: Record<string, { kind: string; text?: string }[]>;
      };
      return (pages.index ?? []).flatMap((block) => (block.text === undefined ? [] : [block.text]));
    };
    expect(await texts('chs')).toEqual(['SAGAS', '古老的故事']);
    expect(await texts('eng')).toEqual(['SAGAS', 'Old tales']);
    expect(warnings()).toEqual([expect.stringContaining('refused ger history overlay')]);
  });

  it('keeps the book a pack-shipped overlay language ships over its overlay', async () => {
    const dir = join('Data', 'text', 'ita', 'hypertext', 'history');
    await temp.write(join(dir, 'Book.txt'), utf8('[blockstart:body]\nSaghe\n[blockend:body]\n'));
    await temp.write(join(dir, 'index.hlt'), utf8('<include:$local$\\Book.txt,body,1>\n'));
    const roots: SourceRoots = {
      data: temp.game,
      overlays: overlays({
        books: new Map<Language, ReadonlyMap<string, BookOverlay>>([
          ['ita', new Map([['history', book({ 'book.txt': { body: 'Altre saghe' } })]])],
        ]),
      }),
    };

    const done = await convertGuiHistory(roots, temp.out, ['ita']);

    expect(done.map((result) => result.lang)).toEqual(['ita']);
    const { pages } = (await readJson(join(temp.out, 'gui', 'history', 'ita.json'))) as {
      pages: Record<string, { text?: string }[]>;
    };
    expect((pages.index ?? []).flatMap((block) => (block.text === undefined ? [] : [block.text]))).toEqual([
      'Saghe',
    ]);
    expect(warnings()).toEqual([expect.stringContaining('skipped ita history overlay')]);
  });
});

describe('campaigns stage', () => {
  const CAMPAIGN = 'overlaid';
  const CAMPAIGN_SLOT = 100;
  const MAPS = ['campaign_01_01', 'campaign_01_02'] as const;

  const mapCif = (mission: number): Uint8Array =>
    buildStringCif([
      { level: 1, text: 'logiccontrol' },
      { level: 2, text: 'mapsize 1 1' },
      { level: 1, text: 'logiccontrolend' },
      { level: 1, text: 'misc_maptype' },
      { level: 2, text: `mapcampaignid ${CAMPAIGN_SLOT} ${mission}` },
    ]);

  function source(): CampaignSource {
    return {
      id: CAMPAIGN,
      campaignId: CAMPAIGN_SLOT,
      order: 1,
      title: { pol: 'Nakladka' },
      languages: ['pol'],
      background: 'presentation/map.png',
      stages: [{ missionId: 1, x: 0.5, y: 0.5 }],
      movies: {},
      maps: MAPS.map((id) => ({
        id,
        shared: { 'map.dat': 'world/map.dat', 'map.cif': 'world/map.cif' },
        locales: { pol: { 'text/pol/strings.ini': 'locales/pol/strings.ini' } },
      })),
    };
  }

  it('adds an overlay language every map carries, leaves out a partial one and refuses source languages', async () => {
    const pack = join(temp.root, 'pack');
    const digests: string[] = [];
    for (const [index, id] of MAPS.entries()) {
      const dat = buildMapDat(1, 1, [index, index, index, index]);
      digests.push(digestOf(dat));
      const dir = join(pack, 'campaigns', CAMPAIGN, 'maps', id);
      await writeFileWithParents(join(dir, 'world/map.dat'), dat);
      await writeFileWithParents(join(dir, 'world/map.cif'), mapCif(index + 1));
      await writeFileWithParents(
        join(dir, 'locales/pol/strings.ini'),
        `[text]\nstring "Etap ${index + 1}"\n`,
      );
    }
    await writeFileWithParents(join(pack, 'campaigns', CAMPAIGN, 'presentation/map.png'), 'png');
    const [first = '', second = ''] = digests.map(mapOverlayDatKey);
    const title = (text: string): CampaignOverlay => ({ version: OVERLAY_VERSION, title: text });
    const roots: SourceRoots = {
      data: join(pack, 'base'),
      overlays: overlays({
        maps: new Map([
          [
            first,
            new Map<Language, readonly MapOverlay[]>([
              ['chs', [mapOverlay({ '0': '第一阶段' })]],
              ['cht', [mapOverlay({ '0': '第一階段' })]],
              ['eng', [mapOverlay({ '0': 'Stage one' })]],
            ]),
          ],
          [second, new Map<Language, readonly MapOverlay[]>([['chs', [mapOverlay({ '0': '第二阶段' })]]])],
        ]),
        campaigns: new Map<Language, ReadonlyMap<string, CampaignOverlay>>([
          ['chs', new Map([[CAMPAIGN, title('覆盖')]])],
          ['eng', new Map([[CAMPAIGN, title('Overlay')]])],
        ]),
      }),
    };

    const result = await convertCampaignStage(roots, pack, [source()], temp.out, new Set());

    const [campaign] = result.index.campaigns;
    expect(campaign?.languages).toEqual(['pol', 'chs']);
    expect(campaign?.title).toEqual({ pol: 'Nakladka', chs: '覆盖' });
    expect(campaign?.stages[0]?.title).toEqual({ pol: 'Etap 1', chs: '第一阶段' });
    expect(result.maps[0]?.overlays.map((outcome) => `${outcome.lang}:${outcome.status}`)).toEqual([
      'eng:refused',
      'chs:applied',
      'cht:applied',
    ]);
    const strings = MapStrings.parse(
      await readJson(join(temp.out, 'maps', `${campaignMapId(CAMPAIGN, MAPS[0])}.strings.json`)),
    );
    expect(strings).toEqual({ pol: { '0': 'Etap 1' }, chs: { '0': '第一阶段' }, cht: { '0': '第一階段' } });
    expect(warnings()).toEqual(
      expect.arrayContaining([
        expect.stringContaining('translation overlay eng refused'),
        expect.stringContaining('cht overlays cover 1 of 2 maps'),
        expect.stringContaining('refused eng title overlay'),
      ]),
    );
  });

  it("keeps a pack-shipped overlay language's own map text and title over its overlays", async () => {
    const pack = join(temp.root, 'pack');
    const keys: string[] = [];
    for (const [index, id] of MAPS.entries()) {
      const dat = buildMapDat(1, 1, [index, index, index, index]);
      keys.push(mapOverlayDatKey(digestOf(dat)));
      const dir = join(pack, 'campaigns', CAMPAIGN, 'maps', id);
      await writeFileWithParents(join(dir, 'world/map.dat'), dat);
      await writeFileWithParents(join(dir, 'world/map.cif'), mapCif(index + 1));
      await writeFileWithParents(
        join(dir, 'locales/pol/strings.ini'),
        `[text]\nstring "Etap ${index + 1}"\n`,
      );
      await writeFileWithParents(
        join(dir, 'locales/ita/strings.ini'),
        `[text]\nstring "Tappa ${index + 1}"\n`,
      );
    }
    await writeFileWithParents(join(pack, 'campaigns', CAMPAIGN, 'presentation/map.png'), 'png');
    const shipped = source();
    const campaign: CampaignSource = {
      ...shipped,
      title: { pol: 'Nakladka', ita: 'Sovrapposta' },
      languages: ['pol', 'ita'],
      maps: shipped.maps.map((map) => ({
        ...map,
        locales: { ...map.locales, ita: { 'text/ita/strings.ini': 'locales/ita/strings.ini' } },
      })),
    };
    const roots: SourceRoots = {
      data: join(pack, 'base'),
      overlays: overlays({
        maps: new Map(
          keys.map((key) => [
            key,
            new Map<Language, readonly MapOverlay[]>([['ita', [mapOverlay({ '0': 'Altro' })]]]),
          ]),
        ),
        campaigns: new Map<Language, ReadonlyMap<string, CampaignOverlay>>([
          ['ita', new Map([[CAMPAIGN, { version: OVERLAY_VERSION, title: 'Altra' }]])],
        ]),
      }),
    };

    const result = await convertCampaignStage(roots, pack, [campaign], temp.out, new Set());

    const [entry] = result.index.campaigns;
    expect(entry?.languages).toEqual(['pol', 'ita']);
    expect(entry?.title).toEqual({ pol: 'Nakladka', ita: 'Sovrapposta' });
    expect(entry?.stages[0]?.title).toEqual({ pol: 'Etap 1', ita: 'Tappa 1' });
    expect(result.maps[0]?.overlays.map((outcome) => `${outcome.lang}:${outcome.status}`)).toEqual([
      'ita:redundant',
    ]);
    expect(warnings()).toEqual(
      expect.arrayContaining([
        expect.stringContaining('skipped ita title overlay: the pack ships the title'),
      ]),
    );
  });
});
