import { describe, expect, it } from 'vitest';
import { fetchMapdbPages, MAPDB_PAGE_SIZE } from '../../src/upstream/mapdb.js';
import { parseMapdbPage } from '../../src/upstream/mapdb-parse.js';
import {
  FakeMapdb,
  MAPDB_SEARCH_URL,
  MAPDB_UPSTREAM,
  mapdbDatei,
  mapdbMapRow,
  mapdbMaps,
  mapdbPage,
  mapdbRow,
} from '../support/mapdb-fixture.js';

describe('parseMapdbPage', () => {
  const html = mapdbPage([
    mapdbMapRow({
      title: '6: Wareham',
      author: 'DTFuchs',
      authorId: 178,
      campaignId: 94,
      players: 'M',
      genre: 'Kampf',
      description: 'Bis zu 6 Wikingerstämme versuchen die Stadt Wareham einzunehmen.',
    }),
    mapdbMapRow({
      title: 'Sommerurlaub',
      author: 'angeldragon',
      authorId: 42,
      language: 'EN',
      genre: '',
      description: '',
    }),
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
  const records = parseMapdbPage(html);

  it('reads one record per three-row group, in page order', () => {
    expect(records).toHaveLength(3);
    expect(records.map((record) => record.title)).toEqual([
      '6: Wareham',
      'Sommerurlaub',
      '9. Impressum 2015',
    ]);
  });

  it('reads the flags, the title and the download of the first row', () => {
    expect(records[0]).toMatchObject({
      downloadPath: `/mapdb/download.php?datei=${mapdbDatei('6Wareham_v2-1-0.exe')}`,
      screenshotPath: '/femaps/Screens/6Wareham_v2-1-0.jpg',
      campaignId: 94,
      language: 'de',
      players: 'multi',
    });
    expect(records[2]).toMatchObject({
      downloadPath: null,
      campaignId: 85,
      language: 'de',
      players: 'single',
    });
  });

  it('reads genre, description and author from the rows that follow', () => {
    expect(records[0]).toMatchObject({ genre: 'Kampf', author: 'DTFuchs', authorId: 178 });
    expect(records[0]?.description).toBe('Bis zu 6 Wikingerstämme versuchen die Stadt Wareham einzunehmen.');
    expect(records[1]).toMatchObject({ genre: '', description: '', author: 'angeldragon', authorId: 42 });
  });

  it('decodes entities and keeps the text of a single line as written', () => {
    const page = mapdbPage([
      mapdbMapRow({ title: 'Röse & Ruh &#38; &#x2713;', description: 'Wasser &nbsp; und&nbsp;Wald' }),
    ]);
    const [record] = parseMapdbPage(page);
    expect(record?.title).toBe('Röse & Ruh & ✓');
    expect(record?.description).toBe('Wasser und Wald');
  });

  it('ignores rows outside the three-row shape and a page without maps', () => {
    expect(parseMapdbPage(mapdbPage([]))).toEqual([]);
    expect(parseMapdbPage('<html><body><table><tr><td>nothing</td></tr></table></body></html>')).toEqual([]);
  });

  it('reads a page cut off after the title row with the fields it still has', () => {
    const firstRow = mapdbMapRow({ title: 'Halbe Seite' }).split('</tr><tr')[0] ?? '';
    const [record] = parseMapdbPage(mapdbPage([`${firstRow}</tr>`]));
    expect(record).toMatchObject({ title: 'Halbe Seite', genre: '', description: '', author: '' });
  });
});

describe('fetchMapdbPages', () => {
  it('posts the search form a page at a time and stops at a short page', async () => {
    const upstream = new FakeMapdb([mapdbMaps(MAPDB_PAGE_SIZE), mapdbMaps(5)]);
    const records = await fetchMapdbPages(upstream.fetch, MAPDB_UPSTREAM);
    expect(records).toHaveLength(MAPDB_PAGE_SIZE + 5);
    expect(upstream.requests.map(({ body }) => body.get('pos'))).toEqual(['0', String(MAPDB_PAGE_SIZE)]);
    const request = upstream.requests[0];
    expect(new URL(request?.url ?? '').toString()).toBe(MAPDB_SEARCH_URL);
    expect(request?.body.get('titel')).toBe('%');
    expect(request?.body.get('bereich')).toBe(String(MAPDB_PAGE_SIZE));
    expect(request?.body.get('order')).toBe('ausgabe DESC');
    expect(request?.body.get('language')).toBe('0');
    expect(request?.body.get('single')).toBe('0');
  });

  it('fails the whole download when a page fails', async () => {
    const upstream = new FakeMapdb([mapdbMaps(MAPDB_PAGE_SIZE)]);
    const failing = () => fetchMapdbPages(upstream.fetch, MAPDB_UPSTREAM);
    await expect(failing()).rejects.toThrow(/404/);
  });

  it('keeps fetching while pages come back full', async () => {
    const upstream = new FakeMapdb([mapdbMaps(MAPDB_PAGE_SIZE), mapdbMaps(MAPDB_PAGE_SIZE), mapdbMaps(1)]);
    const records = await fetchMapdbPages(upstream.fetch, MAPDB_UPSTREAM);
    expect(upstream.requests).toHaveLength(3);
    expect(records).toHaveLength(2 * MAPDB_PAGE_SIZE + 1);
  });
});
