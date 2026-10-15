import { mapDocumentsFingerprint } from '@open-northland/data';
import { CIF_SLOT_DECODE_UNITS } from '@open-northland/formats/cif';
import { encodeMapDat, encodeMapSize, packMapLayer } from '@open-northland/formats/mapdat/index';
import { encodePcx } from '@open-northland/formats/pcx';
import { zipSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';
import { encodeC2m } from '../../formats/test/fixtures/c2m.js';
import { buildCifPool } from '../../formats/test/fixtures/cif.js';
import { openZip } from '../src/archives/open.js';
import { type ConvertProgress, convertMapFolder, convertMapTree } from '../src/convert.js';
import { MapImportError, type MapImportFailure } from '../src/errors.js';
import { mapFiles } from '../src/files.js';
import { DEFAULT_IMPORT_LIMITS, NO_IMPORT_LIMITS } from '../src/limits.js';
import { treeFromFolder } from '../src/tree.js';
import { latin1, treeOf } from './support/folder.js';
import { mapDat, plaintextMap, under } from './support/maps.js';

async function failure(promise: Promise<unknown>): Promise<{ kind: MapImportFailure; message: string }> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof MapImportError) return { kind: err.kind, message: err.message };
    throw err;
  }
  throw new Error('expected a MapImportError');
}

describe('convertMapTree', () => {
  it.each(['map.cif', 'text/pol/strings.cif'])(
    'refuses over-budget CIF expansion in %s instead of skipping the optional file',
    async (path) => {
      const cif = buildCifPool(latin1('\u0002string "repeated"\0'), new Uint8Array(1024 * 4));
      const tree = treeOf({ 'map.dat': mapDat(), [path]: cif });
      const result = await failure(
        convertMapTree(tree, {
          provenance: 'user',
          limits: { ...DEFAULT_IMPORT_LIMITS, cifDecodeUnits: 2 * CIF_SLOT_DECODE_UNITS },
        }),
      );
      expect(result).toMatchObject({ kind: 'too-large', message: expect.stringContaining('cif:') });
    },
  );

  it('shares the CIF budget across maps and localized tables in a pack', async () => {
    const pool = latin1('\u0001text\0');
    const cif = buildCifPool(pool, new Uint8Array(4));
    const tree = treeOf({
      'a/map.dat': mapDat(),
      'a/map.cif': cif,
      'b/map.dat': mapDat(),
      'b/text/pol/strings.cif': cif,
    });
    const units = CIF_SLOT_DECODE_UNITS + pool.length;
    expect(
      await failure(
        convertMapTree(tree, {
          provenance: 'catalog',
          limits: { ...DEFAULT_IMPORT_LIMITS, cifDecodeUnits: units, totalCifDecodeUnits: units * 2 - 1 },
        }),
      ),
    ).toMatchObject({ kind: 'too-large' });
    expect(
      (
        await convertMapTree(tree, {
          provenance: 'catalog',
          limits: { ...DEFAULT_IMPORT_LIMITS, cifDecodeUnits: units, totalCifDecodeUnits: units * 2 },
        })
      ).maps,
    ).toHaveLength(2);
  });

  it('converts a campaign pack: the main map and its sub-mission folder, each with its own id', async () => {
    const tree = treeOf({
      ...under('Kampania/Glowna', { ...plaintextMap('Glowna'), 'misc.inc': '[misc_maptype]\nmaptype 2\n' }),
      ...under('Kampania/Glowna_SUB1', {
        ...plaintextMap('Wyprawa'),
        'misc.inc': '[misc_maptype]\nmaptype 1\nmapcampaignid 0 7\n',
      }),
      'Kampania/changelog.txt': 'stray',
    });
    const { maps, skipped } = await convertMapTree(tree, { provenance: 'catalog' });
    expect(skipped).toEqual([]);
    expect(maps.map((m) => [m.id, m.folder])).toEqual([
      ['glowna', 'Kampania/Glowna'],
      ['glowna_sub1', 'Kampania/Glowna_SUB1'],
    ]);
    const [main, sub] = maps;
    expect(main?.meta).toEqual({
      name: { pol: 'Glowna' },
      description: { pol: 'Opis' },
      mapTypes: [2],
      provenance: { kind: 'catalog', folder: 'Kampania/Glowna' },
    });
    expect(sub?.meta.campaign).toEqual({ campaignId: 0, missionId: 7 });
    expect(sub?.terrain.typeIds).toEqual([2, 5]);
    expect(sub?.script?.players.map((p) => p.player)).toEqual([0, 1]);
    expect(sub?.script?.source?.file).toBe('Kampania/Glowna_SUB1/player.inc+mission.inc+misc.inc');
    expect(sub?.index).toMatchObject({
      id: 'glowna_sub1',
      campaign: { campaignId: 0, missionId: 7 },
      name: { pol: 'Wyprawa' },
      picture: false,
      minimap: false,
    });
    expect(sub?.strings).toEqual({ pol: { 0: 'Wyprawa', 1: 'Opis' } });
  });

  it('fingerprints one map the same under two folder paths, as the served documents hash', async () => {
    const files = { ...plaintextMap('Wyspa'), 'misc.inc': '[misc_maptype]\nmaptype 2\n' };
    const [first] = (
      await convertMapTree(treeOf(under('maps/community/Wyspa', files)), { provenance: 'mod' })
    ).maps;
    const [second] = (await convertMapTree(treeOf(under('Wyspa', files)), { provenance: 'catalog' })).maps;
    if (first === undefined || second === undefined) throw new Error('no map');
    expect(first.script?.source?.file).not.toBe(second.script?.source?.file);
    expect(first.index.fingerprint).toBe(second.index.fingerprint);
    const served = mapFiles(first);
    const read = (name: string): unknown => {
      const file = served.get(name);
      return file === undefined ? null : JSON.parse(String(file));
    };
    expect(first.index.fingerprint).toBe(
      mapDocumentsFingerprint({ map: read('wyspa.json'), script: read('wyspa.script.json') }),
    );
  });

  it('names a map at the tree root after the import, and classifies provenance per folder', async () => {
    const tree = treeOf(plaintextMap('Wyspa'));
    const { maps } = await convertMapTree(tree, { provenance: () => 'user', rootName: 'Wyspa Egejska' });
    expect(maps[0]?.id).toBe('wyspa_egejska');
    expect(maps[0]?.meta.provenance).toEqual({ kind: 'user', folder: 'Wyspa Egejska' });
  });

  it('converts the map of a .c2m nested in a zip under the export name', async () => {
    const c2m = encodeC2m({ 'map.dat': mapDat(), 'map.cif': new Uint8Array(3) });
    const tree = await openZip(zipSync({ 'TGC_English.c2m': c2m }));
    const { maps } = await convertMapTree(tree, { provenance: 'catalog' });
    expect(maps.map((m) => m.id)).toEqual(['tgc_english']);
  });

  it('fails a tree without map.dat as no-map', async () => {
    const tree = treeOf({ 'Map/map.ini': '[misc_maptype]\nmaptype 1\n' });
    expect((await failure(convertMapTree(tree, { provenance: 'catalog' }))).kind).toBe('no-map');
  });

  it('skips an undecodable map.dat beside a good one, and fails decode-failed when none decodes', async () => {
    const broken = { 'Broken/map.dat': latin1('not a map') };
    const { maps, skipped } = await convertMapTree(
      treeOf({ ...broken, ...under('Good', plaintextMap('G')) }),
      {
        provenance: 'catalog',
      },
    );
    expect(maps.map((m) => m.id)).toEqual(['good']);
    expect(skipped).toEqual([
      { folder: 'Broken', message: expect.stringMatching(/^Broken\/map\.dat: mapdat:/) },
    ]);
    const all = await failure(convertMapTree(treeOf(broken), { provenance: 'catalog' }));
    expect(all.kind).toBe('decode-failed');
    expect(all.message).toMatch(/mapdat:/);
  });

  it('fails a map whose lsiz declares more cells than the limit as too-large, beside a good map', async () => {
    const side = Math.sqrt(DEFAULT_IMPORT_LIMITS.cells) + 1;
    const huge = encodeMapDat([
      { tag: 'lsiz', version: 1, payload: encodeMapSize({ width: side, height: side }) },
      { tag: 'lmlt', version: 1, payload: packMapLayer(new Uint8Array(4)) },
    ]);
    const tree = treeOf({ 'Huge/map.dat': huge, ...under('Good', plaintextMap('G')) });
    const result = await failure(convertMapTree(tree, { provenance: 'catalog' }));
    expect(result.kind).toBe('too-large');
    expect(result.message).toMatch(/^Huge\/map\.dat: mapdat: lsiz/);
  });

  it('fails a map picture over the pixel limit as too-large, and converts it within the limit', async () => {
    const pixels = new Uint8Array(12).fill(1);
    const picture = encodePcx({ width: 4, height: 3, pixels, palette: new Uint8Array(768) });
    const tree = treeOf(under('M', { ...plaintextMap('M'), 'minimap/minimap.pcx': picture }));
    const limits = (picturePixels: number) => ({ ...DEFAULT_IMPORT_LIMITS, picturePixels });
    const over = await failure(
      convertMapTree(tree, { provenance: 'catalog', limits: limits(pixels.length - 1) }),
    );
    expect(over.kind).toBe('too-large');
    const within = await convertMapTree(tree, { provenance: 'catalog', limits: limits(pixels.length) });
    expect(within.maps[0]?.picture).toBeDefined();
  });

  it('bounds retained campaign cells before decoding the map that exceeds the remaining budget', async () => {
    const tree = treeOf({ ...under('A', plaintextMap('A')), ...under('B', plaintextMap('B')) });
    const progress: ConvertProgress[] = [];
    const limits = { ...DEFAULT_IMPORT_LIMITS, cells: 2, totalCells: 3 };
    const result = await failure(
      convertMapTree(tree, { provenance: 'catalog', limits, onProgress: (p) => progress.push(p) }),
    );
    expect(result.kind).toBe('too-large');
    expect(progress.filter((p) => p.folder === 'B').map((p) => p.stage)).toEqual(['terrain']);
    const within = await convertMapTree(tree, {
      provenance: 'catalog',
      limits: { ...limits, totalCells: 4 },
    });
    expect(within.maps).toHaveLength(2);
  });

  it('reports every stage per map, and optional-file problems as warnings', async () => {
    const progress: ConvertProgress[] = [];
    const onWarning = vi.fn();
    const tree = treeOf(under('M', { ...plaintextMap('M'), 'minimap/minimap.pcx': latin1('broken') }));
    await convertMapTree(tree, { provenance: 'catalog', onProgress: (p) => progress.push(p), onWarning });
    expect(progress.map((p) => p.stage)).toEqual([
      'terrain',
      'entities',
      'strings',
      'meta',
      'script',
      'briefing',
      'picture',
      'minimap',
    ]);
    expect(progress[0]).toEqual({ folder: 'M', index: 0, total: 1, stage: 'terrain' });
    expect(onWarning).toHaveBeenCalledWith(
      expect.stringMatching(/^map M\/map\.dat: minimap picture undecodable/),
    );
  });

  it('passes the decoded terrain to the caller-supplied minimap rasterizer', async () => {
    const tree = treeOf(under('M', plaintextMap('M')));
    const minimap = vi.fn(async () => Uint8Array.of(9));
    const map = await convertMapFolder(tree, 'm', { provenance: 'mod', minimap });
    expect(minimap).toHaveBeenCalledWith(expect.objectContaining({ width: 2, height: 1 }));
    expect(map.minimap).toEqual(Uint8Array.of(9));
    expect(map.index.minimap).toBe(true);
  });
});

describe('mapFiles', () => {
  it('names each document after the map id, compact JSON with a trailing newline', async () => {
    const { maps } = await convertMapTree(treeOf(under('Arena', plaintextMap('Arena'))), {
      provenance: 'catalog',
    });
    const [map] = maps;
    if (map === undefined) throw new Error('no map');
    const files = mapFiles(map);
    expect([...files.keys()]).toEqual([
      'arena.json',
      'arena.strings.json',
      'arena.meta.json',
      'arena.script.json',
    ]);
    expect(files.get('arena.meta.json')).toBe(`${JSON.stringify(map.meta)}\n`);
  });

  it('keeps the briefing voices the pages speak and the folder ships, per language', async () => {
    const wav = latin1('RIFF\x04\0\0\0WAVE');
    const tree = treeOf({
      ...plaintextMap('Voiced'),
      'mission.inc': '[MissionData]\ndebuginfo "Briefing"\nresult "PlayCutscene" 0 1\n',
      'text/pol/briefings/0000.hlt': '<onscreencallback:2000,1,0>\nslowo\n<onscreencallback:2000,2,0>\n',
      'text/pol/briefings/briefings.txt': '',
      'text/eng/briefings/0000.hlt': '<onscreencallback:2000,3,0>\nword\n',
      'text/eng/briefings/briefings.txt': '',
      'SFX/POL/0001.wav': wav,
      'sfx/eng/0003.wav': latin1('not a wav'),
      'sfx/pol/0009.wav': wav,
    });
    const warnings: string[] = [];
    const map = await convertMapFolder(tree, '', {
      provenance: 'user',
      rootName: 'Voiced',
      onWarning: (message) => warnings.push(message),
    });
    expect([...map.voices.keys()]).toEqual(['.voice-pol-0001.wav']);
    expect(map.index.voices).toEqual(['.voice-pol-0001.wav']);
    expect(mapFiles(map).get('voiced.voice-pol-0001.wav')).toBe(wav);
    expect(warnings).toEqual([expect.stringContaining('sfx/eng/0003.wav is not a wav')]);
  });
});

describe('treeFromFolder', () => {
  it('reads only the files a conversion knows', async () => {
    const read = vi.fn(async (path: string) => latin1(path));
    const tree = await treeFromFolder(
      [
        'Map\\map.dat',
        'Map/readme.txt',
        'Map/Text/POL/strings.ini',
        'Map/SFX/pol/0001.wav',
        'Map/sfx/pol/intro.wav',
        'Map/sfx/xyz/0002.wav',
      ],
      read,
    );
    expect(read.mock.calls.map(([path]) => path)).toEqual([
      'Map\\map.dat',
      'Map/Text/POL/strings.ini',
      'Map/SFX/pol/0001.wav',
    ]);
    expect([...tree.names.values()]).toEqual([
      'Map/map.dat',
      'Map/Text/POL/strings.ini',
      'Map/SFX/pol/0001.wav',
    ]);
  });
});

it('reports expanding briefing includes as too-large before retaining a map', async () => {
  const include = '<include:f,b>';
  const tree = treeOf({
    ...plaintextMap('Expansion'),
    'mission.inc': '[MissionData]\ndebuginfo "Briefing"\nresult "PlayCutscene" 0 1\n',
    'text/pol/briefings/0000.hlt': include,
    'text/pol/briefings/briefings.txt': `[blockstart:b]\nword ${include.repeat(20)}\n[blockend:b]`,
  });
  expect(
    (
      await failure(
        convertMapTree(tree, { provenance: 'user', hypertextBudget: { remaining: 16 * 1024 * 1024 } }),
      )
    ).kind,
  ).toBe('too-large');
});

it('shares the briefing expansion allowance across maps in a pack', async () => {
  const files = {
    ...plaintextMap('Briefing'),
    'mission.inc': '[MissionData]\ndebuginfo "Briefing"\nresult "PlayCutscene" 0 1\n',
    'text/pol/briefings/0000.hlt': 'word',
    'text/pol/briefings/briefings.txt': '',
  };
  const tree = treeOf({ ...under('a', files), ...under('b', files) });
  expect(
    (await failure(convertMapTree(tree, { provenance: 'user', hypertextBudget: { remaining: 12 } }))).kind,
  ).toBe('too-large');
  expect(
    (await convertMapTree(tree, { provenance: 'user', hypertextBudget: { remaining: 16 } })).maps,
  ).toHaveLength(2);
});

it('keeps untrusted briefing limits while explicitly trusted folder and pack conversions are unlimited', async () => {
  const files = {
    ...plaintextMap('Long briefing'),
    'mission.inc': '[MissionData]\ndebuginfo "Briefing"\nresult "PlayCutscene" 0 1\n',
    'text/pol/briefings/0000.hlt': 'x'.repeat(DEFAULT_IMPORT_LIMITS.hypertextCharacters),
    'text/pol/briefings/briefings.txt': '',
  };
  const tree = treeOf({ ...under('a', files), ...under('b', files), ...under('c', files) });
  for (const provenance of ['catalog', 'user', 'mod'] as const) {
    expect((await failure(convertMapTree(tree, { provenance }))).kind).toBe('too-large');
  }
  const trusted = { provenance: 'mod' as const, limits: NO_IMPORT_LIMITS };
  expect((await convertMapFolder(tree, 'a', trusted)).briefing).toBeDefined();
  expect((await convertMapTree(tree, trusted)).maps).toHaveLength(3);
});
