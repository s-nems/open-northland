import { Catalog } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  firstSeenDates,
  mapdbDateiPath,
  mapdbMapId,
  mapdbPageUrl,
  normalizeMapdbRecords,
  WIKINGER_TOMMY_ID_PREFIX,
} from '../../src/catalog/normalize-mapdb.js';
import type { MapdbRecord } from '../../src/upstream/mapdb-parse.js';
import { parseMapdbPage } from '../../src/upstream/mapdb-parse.js';
import { MAPDB_UPSTREAM, mapdbDatei, mapdbMapRow, mapdbPage, mapdbRow } from '../support/mapdb-fixture.js';

const NOW = () => '2026-11-01T00:00:00.000Z';

const recordsOf = (rows: readonly string[], firstSeen = new Map()) =>
  normalizeMapdbRecords(parseMapdbPage(mapdbPage(rows)), MAPDB_UPSTREAM, firstSeen, NOW);

describe('mapdbDateiPath', () => {
  it('decodes the datei path of a download link', () => {
    expect(mapdbDateiPath(`/mapdb/download.php?datei=${mapdbDatei('DTFuchs6Wareham_v2-1-0.exe')}`)).toBe(
      '/femaps/Maps/DTFuchs6Wareham_v2-1-0.exe',
    );
  });

  it('refuses anything that is not a plain exe download on the mapdb host path', () => {
    expect(mapdbDateiPath('/mapdb/other.php?datei=%2Ffemaps%2FMaps%2Fa.exe')).toBeNull();
    expect(mapdbDateiPath('/mapdb/download.php')).toBeNull();
    expect(mapdbDateiPath(`/mapdb/download.php?datei=${mapdbDatei('a.zip')}`)).toBeNull();
    expect(mapdbDateiPath('/mapdb/download.php?datei=%2F..%2F..%2Fetc%2Fpasswd.exe')).toBeNull();
    expect(mapdbDateiPath('/mapdb/download.php?datei=%2Ffemaps%2FMaps%2Fa%20%2F..%2Fb.exe')).toBeNull();
    expect(mapdbDateiPath('/mapdb/download.php?datei=%FF.exe')).toBeNull();
  });
});

describe('mapdbMapId', () => {
  it('slugs the file name under the wt prefix and stays inside the id schema', () => {
    expect(mapdbMapId('/femaps/Maps/DTFuchs6Wareham_v2-1-0.exe')).toBe('wt-dtfuchs6wareham_v2-1-0');
    expect(mapdbMapId('/femaps/Maps/Größe und Wald_v2.exe')).toBe('wt-grosse-und-wald_v2');
    expect(mapdbMapId('/femaps/Maps/a.exe')?.length).toBeLessThanOrEqual(128);
    expect(mapdbMapId('/femaps/Maps/????.exe')).toBeNull();
  });
});

describe('normalizeMapdbRecords', () => {
  const { records, skipped } = recordsOf([
    mapdbMapRow({ title: '6: Wareham', authorId: 178, campaignId: 94, players: 'M' }),
    mapdbMapRow({ title: 'Sommerurlaub', author: 'angeldragon', authorId: 42, genre: 'Bummelbauer' }),
    mapdbRow({
      title: '9. Impressum 2015',
      author: 'Mapperteam',
      authorId: 69,
      downloadName: null,
      screenshot: 'MapperteamImpressum15',
      campaignId: 85,
      language: 'DE',
      players: 'S',
      genre: 'Gemischt',
      description: 'Wer hat denn nun die Maps gebaut?',
    }),
  ]);
  const wareham = records.find(({ entry }) => entry.title === '6: Wareham');

  it('builds schema-valid wt entries sorted by id', () => {
    expect(records.map(({ entry }) => entry.id)).toEqual([...records.map(({ entry }) => entry.id)].sort());
    expect(records.every(({ entry }) => entry.id.startsWith(WIKINGER_TOMMY_ID_PREFIX))).toBe(true);
    expect(() => Catalog.parse(records.map(({ entry }) => entry))).not.toThrow();
    expect(skipped).toEqual([
      { upstreamId: '9. Impressum 2015', reason: 'no download; the page says to load it from its campaign' },
    ]);
  });

  it('maps the row facts onto the catalogue fields', () => {
    expect(wareham?.entry).toEqual(
      expect.objectContaining({
        id: 'wt-6wareham_v2-1-0',
        title: '6: Wareham',
        author: 'DTFuchs',
        kind: 'multi',
        series: false,
        categoryLabel: 'Kampf',
        shortDescription: '',
        fullDescription: 'Eine Testkarte.',
        publishedAt: NOW(),
        updatedAt: NOW(),
        downloadCount: 0,
        likeCount: 0,
        versionText: 'v2-1-0',
        file: { kind: 'archive' },
      }),
    );
    expect(wareham?.entry.source).toEqual({
      documentId: '/femaps/Maps/6Wareham_v2-1-0.exe',
      id: expect.any(Number),
      page: `${MAPDB_UPSTREAM}/mapdb/maps.php?modus=K&Id=94`,
    });
    expect(wareham?.fileUrl).toBe(
      `${MAPDB_UPSTREAM}/mapdb/download.php?datei=${mapdbDatei('6Wareham_v2-1-0.exe')}`,
    );
  });

  it('links a standalone map to its author page and keeps a stable numeric id', () => {
    const sommer = records.find(({ entry }) => entry.title === 'Sommerurlaub');
    expect(sommer?.entry.source.page).toBe(`${MAPDB_UPSTREAM}/mapdb/maps.php?modus=A&Id=42`);
    expect(sommer?.entry.source.id).toBe(
      normalizeMapdbRecords(
        parseMapdbPage(mapdbPage([mapdbMapRow({ title: 'Sommerurlaub' })])),
        MAPDB_UPSTREAM,
      ).records[0]?.entry.source.id,
    );
  });

  it('keeps the first-seen dates of an unchanged record and dates a new one now', () => {
    const first = normalizeMapdbRecords(
      parseMapdbPage(mapdbPage([mapdbMapRow({ title: 'Bleibt' })])),
      MAPDB_UPSTREAM,
      new Map(),
      NOW,
    );
    const documentId = first.records[0]?.entry.source.documentId ?? '';
    const dates = new Map([
      [documentId, { publishedAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-01T00:00:00.000Z' }],
    ]);
    const second = normalizeMapdbRecords(
      parseMapdbPage(mapdbPage([mapdbMapRow({ title: 'Bleibt' })])),
      MAPDB_UPSTREAM,
      dates,
      NOW,
    );
    expect(second.records[0]?.entry.publishedAt).toBe('2020-01-01T00:00:00.000Z');
    expect(
      firstSeenDates([
        {
          id: 'wt-x',
          source: { documentId: 'k', id: 1, page: 'https://a.b/c' },
          publishedAt: 'p',
          updatedAt: 'u',
        } as never,
      ]),
    ).toEqual(new Map([['k', { publishedAt: 'p', updatedAt: 'u' }]]));
  });

  it('skips records whose cells the parser could not read and non-records', () => {
    const page = mapdbPage([mapdbMapRow({ title: 'Ohne Zelle' })]).replace(
      '<td class="mitte">DE</td>',
      '<td class="mitte">??</td>',
    );
    const result = normalizeMapdbRecords(parseMapdbPage(page), MAPDB_UPSTREAM, new Map(), NOW);
    expect(result.records).toEqual([]);
    expect(result.skipped).toEqual([{ upstreamId: 'Ohne Zelle', reason: 'language cell' }]);
    const junk = normalizeMapdbRecords([42, null], MAPDB_UPSTREAM, new Map(), NOW);
    expect(junk.records).toEqual([]);
    expect(junk.skipped).toEqual([
      { upstreamId: null, reason: 'not a mapdb record' },
      { upstreamId: null, reason: 'not a mapdb record' },
    ]);
  });

  it('skips a second record with an id already taken', () => {
    const row = mapdbMapRow({ title: 'Gleich' });
    const result = normalizeMapdbRecords(
      parseMapdbPage(mapdbPage([row, row])),
      MAPDB_UPSTREAM,
      new Map(),
      NOW,
    );
    expect(result.records).toHaveLength(1);
    expect(result.skipped).toEqual([{ upstreamId: expect.any(Number), reason: 'duplicate id' }]);
  });

  it('exposes the screenshot for the thumbnail sync', () => {
    expect(wareham?.screenshotUrl).toBe(`${MAPDB_UPSTREAM}/femaps/Screens/6Wareham_v2-1-0.jpg`);
  });

  it('names the campaign page for a campaign part and the bare search page without links', () => {
    const bare: MapdbRecord = {
      title: 'x',
      author: '',
      authorId: null,
      downloadPath: null,
      screenshotPath: null,
      campaignId: null,
      language: 'de',
      players: 'single',
      genre: '',
      description: '',
    };
    expect(mapdbPageUrl(MAPDB_UPSTREAM, bare)).toBe(`${MAPDB_UPSTREAM}/mapdb/maps.php`);
  });
});
