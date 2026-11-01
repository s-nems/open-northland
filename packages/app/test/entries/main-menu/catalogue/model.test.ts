import type { CatalogConvertedMap, CatalogEntry, MapTextLanguage } from '@open-northland/data';
import { catalogBrowseEntry } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  INSTALLED_MAP_RECORD_VERSION,
  type InstalledMapRecord,
} from '../../../../src/content/map-source/index.js';
import { languageCodes } from '../../../../src/entries/main-menu/catalogue/card.js';
import { titleKey } from '../../../../src/entries/main-menu/catalogue/fold.js';
import {
  catalogueRow as browseRow,
  catalogueRows as browseRows,
  type CatalogueRow,
  canDownload,
  installedGroups,
  LARGE_MAP_MAX_CELLS,
  MEDIUM_MAP_MAX_CELLS,
  mainCatalogMap,
  mapSize,
  SMALL_MAP_MAX_CELLS,
  shippedMaps,
} from '../../../../src/entries/main-menu/catalogue/model.js';
import {
  authorCounts,
  authorListing,
  type CatalogueQuery,
  DEFAULT_CATALOGUE_QUERY,
  facetCounts,
  formatBytes,
  hasActiveFilters,
  PROLIFIC_AUTHOR_MIN_MAPS,
  queryRows,
} from '../../../../src/entries/main-menu/catalogue/query.js';
import { catalogEntry, TINY_FINGERPRINT } from '../../../support/catalog-maps.js';
import { seats } from '../../../support/mock-catalogue-api.js';

const catalogueRow = (
  entry: CatalogEntry,
  ...args: Parameters<typeof browseRow> extends [unknown, ...infer Rest] ? Rest : never
) => browseRow(catalogBrowseEntry(entry), ...args);
const catalogueRows = (
  entries: readonly CatalogEntry[],
  ...args: Parameters<typeof browseRows> extends [unknown, ...infer Rest] ? Rest : never
) => browseRows(entries.map(catalogBrowseEntry), ...args);

const IR = 9;
const KIB = 1024;
const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function converted(id: string, mapIds: readonly string[] = [id], irVersion = IR): CatalogEntry {
  const entry = catalogEntry(id, mapIds);
  if (entry.conversion?.verdict !== 'ok') throw new Error('fixture');
  return { ...entry, conversion: { ...entry.conversion, irVersion } };
}

function installed(
  mapId: string,
  entryId: string,
  irVersion = IR,
  fingerprint = TINY_FINGERPRINT,
  languages: readonly MapTextLanguage[] = ['pol'],
): InstalledMapRecord {
  return {
    version: INSTALLED_MAP_RECORD_VERSION,
    revision: '00000000-0000-0000-0000-000000000001',
    mapId,
    entryId,
    fingerprint,
    irVersion,
    languages,
    index: {
      id: mapId,
      fingerprint: TINY_FINGERPRINT,
      picture: false,
      minimap: false,
      provenance: { kind: 'catalog', folder: entryId },
    },
    installedAt: 1,
    size: KIB,
    suffixes: ['.json'],
  };
}

/** A converted single-map entry with the map's seats, languages and size set. */
function mapEntry(
  id: string,
  overrides: Partial<CatalogEntry> = {},
  map: { players?: number; languages?: CatalogConvertedMap['languages']; side?: number } = {},
): CatalogEntry {
  const entry = converted(id);
  if (entry.conversion?.verdict !== 'ok') throw new Error('fixture');
  const [first] = entry.conversion.maps;
  if (first === undefined) throw new Error('fixture');
  const side = map.side ?? 1;
  const only: CatalogConvertedMap = {
    ...first,
    languages: map.languages ?? first.languages,
    cells: { width: side, height: side },
    index: { ...first.index, ...(map.players === undefined ? {} : { players: seats(map.players) }) },
  };
  return { ...entry, conversion: { ...entry.conversion, maps: [only] }, ...overrides };
}

const ids = (rows: readonly CatalogueRow[]): string[] => rows.map((row) => row.entry.id);
const rowsOf = (entries: readonly CatalogEntry[], records: readonly InstalledMapRecord[] = []) =>
  entries.map((entry) => catalogueRow(entry, records, IR));

describe('catalogue rows', () => {
  it("reads each entry's state from the server and the installed maps", () => {
    const status = (entry: CatalogEntry, records: InstalledMapRecord[] = []) =>
      catalogueRow(entry, records, IR).status;
    expect(
      status(
        catalogEntry('x', [], { file: { kind: 'external', url: 'https://x.test' }, conversion: undefined }),
      ),
    ).toBe('external');
    expect(status(catalogEntry('x', [], { conversion: undefined }))).toBe('pending');
    expect(status(catalogEntry('x', [], { conversion: { verdict: 'pending' } }))).toBe('pending');
    const unpackFailed = { verdict: 'failed', reason: 'unsupported-archive', message: 'm' } as const;
    expect(status(catalogEntry('x', [], { conversion: unpackFailed }))).toBe('failed');
    expect(
      status(
        catalogEntry('x', [], {
          file: { kind: 'archive', bytes: KIB, path: '/v1/maps/x/file' },
          conversion: unpackFailed,
        }),
      ),
    ).toBe('manual');
    expect(status(converted('x', ['x'], IR + 1))).toBe('gameTooOld');
    expect(status(converted('x', ['x'], IR - 1))).toBe('serverTooOld');
    expect(status(converted('x'))).toBe('available');
    expect(status(converted('x'), [installed('x', 'x')])).toBe('installed');
    expect(status(converted('x'), [installed('x', 'x', IR, 'e'.repeat(64))])).toBe('updatable');
    // A translation overlay added a language on the server: same documents, new text.
    expect(status(mapEntry('x', {}, { languages: ['pol', 'chs'] }), [installed('x', 'x')])).toBe('updatable');
    expect(
      status(mapEntry('x', {}, { languages: ['pol', 'chs'] }), [
        installed('x', 'x', IR, TINY_FINGERPRINT, ['pol', 'chs']),
      ]),
    ).toBe('installed');
    expect(status(converted('x'), [installed('x', 'x', IR, TINY_FINGERPRINT, ['pol', 'chs'])])).toBe(
      'updatable',
    );
    expect(status(converted('x'), [installed('x', 'x', IR - 1)])).toBe('redownload');
    // Installed for this build, the map stays playable while the server re-converts it.
    expect(status(catalogEntry('x', [], { conversion: { verdict: 'pending' } }), [installed('x', 'x')])).toBe(
      'installed',
    );
    expect(canDownload('redownload') && canDownload('updatable') && !canDownload('pending')).toBe(true);
  });

  it('never lists an entry that holds no map', () => {
    const mapless = catalogEntry('cn-norway', [], {
      file: { kind: 'archive', bytes: KIB, path: '/v1/maps/cn-norway/file' },
      conversion: { verdict: 'failed', reason: 'no-map', message: 'm' },
    });
    expect(ids(catalogueRows([converted('cn-a'), mapless], [], IR))).toEqual(['cn-a']);
  });

  it('shows a pack by its main map, counts the rest and joins their seats and languages', () => {
    const entry = converted('cn-pack', ['cn-pack-2', 'cn-pack', 'cn-pack-3']);
    if (entry.conversion?.verdict !== 'ok') throw new Error('fixture');
    const [a, b, c] = entry.conversion.maps;
    if (a === undefined || b === undefined || c === undefined) throw new Error('fixture');
    const pack: CatalogEntry = {
      ...entry,
      conversion: {
        ...entry.conversion,
        maps: [
          {
            ...a,
            languages: ['ger'],
            cells: { width: 250, height: 250 },
            index: { ...a.index, players: seats(4) },
          },
          { ...b, languages: ['pol', 'eng'], index: { ...b.index, players: seats(2) } },
          { ...c, index: { ...c.index, players: seats(4) } },
        ],
      },
    };
    const row = catalogueRow(pack, [], IR);
    expect(row.mainMapId).toBe('cn-pack-2');
    expect(row.subMapCount).toBe(2);
    expect(row.playerCounts).toEqual([2, 4]);
    expect(row.languages).toEqual(['pol', 'eng', 'ger']);
    expect(row.size).toBe('large');
    const allSub = entry.conversion.maps.map((map) => ({
      ...map,
      index: { ...map.index, campaign: { campaignId: 1, missionId: 1 } },
    }));
    expect(mainCatalogMap(allSub)?.mapId).toBe('cn-pack-2');
    const played = catalogueRow(
      converted('two', ['a', 'b']),
      [installed('a', 'two'), installed('b', 'two')],
      IR,
    );
    expect(played.playableMapId).toBe('a');
  });

  it('sizes a map by its cell area', () => {
    const side = (area: number) => Math.sqrt(area);
    expect(mapSize({ width: side(SMALL_MAP_MAX_CELLS), height: side(SMALL_MAP_MAX_CELLS) })).toBe('small');
    expect(mapSize({ width: side(SMALL_MAP_MAX_CELLS) + 1, height: side(SMALL_MAP_MAX_CELLS) })).toBe(
      'medium',
    );
    expect(mapSize({ width: side(MEDIUM_MAP_MAX_CELLS), height: side(MEDIUM_MAP_MAX_CELLS) })).toBe('medium');
    expect(mapSize({ width: side(MEDIUM_MAP_MAX_CELLS) + 1, height: side(MEDIUM_MAP_MAX_CELLS) })).toBe(
      'large',
    );
    expect(mapSize({ width: side(LARGE_MAP_MAX_CELLS), height: side(LARGE_MAP_MAX_CELLS) })).toBe('large');
    expect(mapSize({ width: side(LARGE_MAP_MAX_CELLS) + 1, height: side(LARGE_MAP_MAX_CELLS) })).toBe('huge');
    // Sized by area: a long map is not huge for its long side alone.
    expect(mapSize({ width: 500, height: 150 })).toBe('huge');
    expect(mapSize({ width: 250, height: 80 })).toBe('small');
  });

  it('groups installed maps by entry, the newest install first, with the catalogue row when listed', () => {
    const records = [
      { ...installed('a', 'pack'), installedAt: 5 },
      { ...installed('b', 'pack'), installedAt: 6 },
      { ...installed('gone', 'gone'), installedAt: 9 },
    ];
    const groups = installedGroups(records, rowsOf([converted('pack', ['a', 'b'])], records));
    expect(groups.map((group) => [group.entryId, group.bytes, group.row?.status ?? null])).toEqual([
      ['gone', KIB, null],
      ['pack', 2 * KIB, 'installed'],
    ]);
  });
});

describe('catalogue rows against the shipped maps', () => {
  const OTHER = 'e'.repeat(64);
  const shippedRow = (id: string, fingerprint = TINY_FINGERPRINT) => ({
    id,
    fingerprint,
    picture: true,
    minimap: true,
    name: { pol: id.toUpperCase() },
  });
  const shipped = shippedMaps([shippedRow('wyspa'), shippedRow('glowna'), shippedRow('zmieniona', OTHER)]);
  /** A converted entry whose maps came from `folders`, each fingerprinted as the tiny map. */
  const fromFolders = (id: string, folders: readonly string[]): CatalogEntry => {
    const entry = converted(
      id,
      folders.map((folder) => `${id}-${folder}`),
    );
    if (entry.conversion?.verdict !== 'ok') throw new Error('fixture');
    const maps = entry.conversion.maps.map((map, i) => ({ ...map, folder: folders[i] ?? map.folder }));
    return { ...entry, conversion: { ...entry.conversion, maps } };
  };
  const row = (entry: CatalogEntry, records: InstalledMapRecord[] = []) =>
    catalogueRow(entry, records, IR, shipped);

  it('plays a map the game ships in the same version from the shipped copy', () => {
    const same = row(fromFolders('cn-wyspa', ['wyspa']));
    expect(same.status).toBe('inGame');
    expect(same.playableMapId).toBe('wyspa');
    expect(same.playableIndex?.id).toBe('wyspa');
    expect(same.shipped).toMatchObject({ index: { id: 'wyspa' }, sameVersion: true });
    expect(canDownload(same.status)).toBe(false);
  });

  it('offers the catalogue copy of a shipped map in another version, or of a partly shipped pack', () => {
    const changed = row(fromFolders('cn-zmieniona', ['zmieniona']));
    expect(changed.status).toBe('inGameChanged');
    expect(changed.playableMapId).toBeNull();
    expect(changed.shipped).toMatchObject({ index: { id: 'zmieniona' }, sameVersion: false });
    expect(canDownload(changed.status)).toBe(true);
    const partly = row(fromFolders('cn-pack', ['glowna', 'glowna_sub1']));
    expect(partly.status).toBe('inGameChanged');
    expect(partly.shipped).toMatchObject({ index: { id: 'glowna' }, sameVersion: true });
    const whole = row(fromFolders('cn-two', ['wyspa', 'glowna']));
    expect(whole.status).toBe('inGame');
  });

  it('plays an entry without a converted copy from the shipped map that carries its title', () => {
    const external = catalogEntry('cn-wyspa', [], {
      title: 'Wyspa',
      file: { kind: 'external', url: 'https://example.test/wyspa' },
      conversion: undefined,
    });
    const found = row(external);
    expect(found.status).toBe('inGame');
    expect(found.playableMapId).toBe('wyspa');
    expect(found.mainMapId).toBe('wyspa');
    expect(found.shipped).toEqual({ index: expect.objectContaining({ id: 'wyspa' }), sameVersion: null });
    expect(row({ ...external, title: 'Wyspa 2' }).status).toBe('external');
    // A converted copy matches by folder only; its title alone does not make it the shipped map.
    expect(row(fromFolders('cn-wyspa', ['inna'])).status).toBe('available');
  });

  it('keeps the states of an installed copy and of a map the game does not ship', () => {
    const entry = fromFolders('cn-wyspa', ['wyspa']);
    expect(row(entry, [installed('cn-wyspa-wyspa', 'cn-wyspa')]).status).toBe('installed');
    expect(row(entry, [installed('cn-wyspa-wyspa', 'cn-wyspa', IR - 1)]).status).toBe('redownload');
    expect(row(fromFolders('cn-nowa', ['nowa'])).status).toBe('available');
    expect(row(converted('cn-wyspa', ['cn-wyspa-wyspa'], IR - 1)).status).toBe('serverTooOld');
  });

  it('hides a shipped map of the same version as owned and keeps one that offers a download', () => {
    const rows = [
      row(fromFolders('cn-wyspa', ['wyspa'])),
      row(fromFolders('cn-zmieniona', ['zmieniona'])),
      row(fromFolders('cn-nowa', ['nowa'])),
    ];
    const run = (patch: Partial<CatalogueQuery>) =>
      ids(queryRows(rows, { ...DEFAULT_CATALOGUE_QUERY, sort: 'title', ...patch }, compare));
    expect(run({ hideOwned: true })).toEqual(['cn-nowa', 'cn-zmieniona']);
    expect(run({ download: 'auto' })).toEqual(['cn-nowa', 'cn-wyspa', 'cn-zmieniona']);
  });
});

describe('catalogue query', () => {
  const entries = [
    mapEntry(
      'cn-burza',
      {
        title: 'Burza piaskowa',
        author: 'Żółw',
        kind: 'multi',
        likeCount: 30,
        downloadCount: 100,
        publishedAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2026-05-01T00:00:00.000Z',
        fullDescription: 'Pustynia\nz oazami',
      },
      { players: 4, languages: ['pol', 'eng'], side: 250 },
    ),
    mapEntry(
      'cn-dolina',
      {
        title: 'Dolina',
        author: 'Ania',
        kind: 'single',
        series: true,
        likeCount: 30,
        downloadCount: 500,
        publishedAt: '2025-06-01T00:00:00.000Z',
        updatedAt: '2025-06-01T00:00:00.000Z',
      },
      { players: 1, languages: ['ger'], side: 100 },
    ),
    mapEntry(
      'cn-atak',
      {
        title: 'Atak',
        author: 'Bartek',
        kind: 'campaign',
        likeCount: 5,
        downloadCount: 900,
        publishedAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        shortDescription: 'Obrona twierdzy',
      },
      { players: 2, languages: ['pol'], side: 180 },
    ),
    catalogEntry('cn-link', [], {
      title: 'Link',
      author: 'Ania',
      kind: 'other',
      categoryLabel: 'Narzędzia',
      file: { kind: 'external', url: 'https://example.test/map' },
      conversion: undefined,
    }),
    catalogEntry('cn-zepsuta', [], {
      title: 'Zepsuta',
      conversion: { verdict: 'failed', reason: 'download-failed', message: 'm' },
    }),
    catalogEntry('cn-reczna', [], {
      title: 'Ręczna',
      file: { kind: 'archive', bytes: KIB, path: '/v1/maps/cn-reczna/file' },
      conversion: { verdict: 'failed', reason: 'decode-failed', message: 'm' },
    }),
  ];
  const rows = rowsOf(entries, [
    installed('cn-dolina', 'cn-dolina'),
    installed('cn-atak', 'cn-atak', IR, 'e'.repeat(64)),
  ]);
  const run = (patch: Partial<CatalogueQuery>, among: readonly CatalogueRow[] = rows) =>
    ids(queryRows(among, { ...DEFAULT_CATALOGUE_QUERY, ...patch }, compare));

  it('orders by each sort, the newest first by default', () => {
    const playable = rows.slice(0, 3);
    expect(run({}, playable)).toEqual(run({ sort: 'newest' }, playable));
    expect(run({ sort: 'downloaded' }, playable)).toEqual(['cn-atak', 'cn-dolina', 'cn-burza']);
    expect(run({ sort: 'liked' }, playable)).toEqual(['cn-dolina', 'cn-burza', 'cn-atak']);
    expect(run({ sort: 'newest' }, playable)).toEqual(['cn-atak', 'cn-dolina', 'cn-burza']);
    expect(run({ sort: 'updated' }, playable)).toEqual(['cn-burza', 'cn-atak', 'cn-dolina']);
    expect(run({ sort: 'title' }, playable)).toEqual(['cn-atak', 'cn-burza', 'cn-dolina']);
    expect(run({ sort: 'author' }, playable)).toEqual(['cn-dolina', 'cn-atak', 'cn-burza']);
  });

  it('lists every entry by default, links and failures included', () => {
    expect(run({ sort: 'title' })).toEqual([
      'cn-atak',
      'cn-burza',
      'cn-dolina',
      'cn-link',
      'cn-reczna',
      'cn-zepsuta',
    ]);
  });

  it('splits the entries by how they download, a failed one under neither', () => {
    expect(run({ download: 'manual', sort: 'title' })).toEqual(['cn-link', 'cn-reczna']);
    expect(run({ download: 'auto', sort: 'title' })).toEqual(['cn-atak', 'cn-burza', 'cn-dolina']);
  });

  it('hides what the player can already play, installed or with an update', () => {
    expect(run({ hideOwned: true, sort: 'title' })).toEqual([
      'cn-burza',
      'cn-link',
      'cn-reczna',
      'cn-zepsuta',
    ]);
  });

  it('narrows by kind, series, seats, language, size and author', () => {
    expect(run({ kind: 'campaign' })).toEqual(['cn-atak']);
    expect(run({ seriesOnly: true })).toEqual(['cn-dolina']);
    expect(run({ players: '4' })).toEqual(['cn-burza']);
    expect(run({ language: 'pol' })).toEqual(['cn-atak', 'cn-burza']);
    expect(run({ size: 'small' })).toEqual(['cn-dolina']);
    expect(run({ size: 'medium' })).toEqual(['cn-atak']);
    expect(run({ size: 'large' })).toEqual(['cn-burza']);
    expect(run({ size: 'huge' })).toEqual([]);
    expect(run({ author: 'Żółw' })).toEqual(['cn-burza']);
    expect(run({ author: 'zolw' })).toEqual(['cn-burza']);
    expect(run({ author: 'Żół' })).toEqual([]);
  });

  it('matches a pack to a seat bucket when any of its maps falls in it, a one-seat map in none', () => {
    const packs = rowsOf([
      mapEntry('cn-piec', {}, { players: 5 }),
      mapEntry('cn-szesc', {}, { players: 6 }),
      mapEntry('cn-dwanascie', {}, { players: 12 }),
      mapEntry('cn-jeden', {}, { players: 1 }),
    ]);
    const bucket = (players: string) => run({ players, sort: 'title' }, packs);
    expect(bucket('5-6')).toEqual(['cn-piec', 'cn-szesc']);
    expect(bucket('9+')).toEqual(['cn-dwanascie']);
    expect(bucket('2')).toEqual([]);
    expect(run({ sort: 'title' }, packs)).toHaveLength(packs.length);
  });

  it('splits the list by community source, read out of the entry id', () => {
    const mixed = rowsOf([
      mapEntry('cn-burza', { title: 'Burza' }),
      mapEntry('wt-sommer', { title: 'Sommerurlaub', author: 'angeldragon' }),
    ]);
    const pick = (patch: Partial<CatalogueQuery>) =>
      ids(queryRows(mixed, { ...DEFAULT_CATALOGUE_QUERY, ...patch }, compare));
    expect(pick({ source: 'wikinger-tommy' })).toEqual(['wt-sommer']);
    expect(pick({ source: 'culturesnation' })).toEqual(['cn-burza']);
    expect(pick({})).toHaveLength(2);
    const [sommer] = mixed.filter((row) => row.entry.id === 'wt-sommer');
    expect(sommer?.source).toBe('wikinger-tommy');
    expect(mixed[0]?.source).toBe('culturesnation');
    const counts = facetCounts(mixed);
    expect(counts.sources.get('culturesnation')).toBe(1);
    expect(counts.sources.get('wikinger-tommy')).toBe(1);
    expect(hasActiveFilters({ ...DEFAULT_CATALOGUE_QUERY, source: 'culturesnation' })).toBe(true);
  });

  it('counts each filter choice over every listed row', () => {
    const counts = facetCounts(rows);
    expect(counts.players.get('4')).toBe(1);
    expect(counts.players.get('2')).toBe(1);
    expect(counts.languages.get('pol')).toBe(2);
    expect(counts.sizes.get('small')).toBe(1);
    expect(counts.downloads.get('manual')).toBe(2);
    expect(counts.downloads.get('auto')).toBe(3);
  });

  it('searches every word in title, author and both descriptions, without diacritics', () => {
    expect(run({ text: 'burza' })).toEqual(['cn-burza']);
    expect(run({ text: 'ZÓŁW' })).toEqual(['cn-burza']);
    expect(run({ text: 'oazami pustynia' })).toEqual(['cn-burza']);
    expect(run({ text: 'twierdzy' })).toEqual(['cn-atak']);
    expect(run({ text: 'twierdzy burza' })).toEqual([]);
    expect(titleKey('PDP : 01 WRÓG NA NASZEJ ZIEMI')).toBe(titleKey('PDP 01: Wróg na naszej ziemi'));
  });

  it('counts only filters as active, not the search or the sort', () => {
    expect(hasActiveFilters(DEFAULT_CATALOGUE_QUERY)).toBe(false);
    expect(hasActiveFilters({ ...DEFAULT_CATALOGUE_QUERY, text: 'x', sort: 'title' })).toBe(false);
    expect(hasActiveFilters({ ...DEFAULT_CATALOGUE_QUERY, download: 'manual' })).toBe(true);
    expect(hasActiveFilters({ ...DEFAULT_CATALOGUE_QUERY, players: '2' })).toBe(true);
    expect(hasActiveFilters({ ...DEFAULT_CATALOGUE_QUERY, hideOwned: true })).toBe(true);
    expect(hasActiveFilters({ ...DEFAULT_CATALOGUE_QUERY, author: 'Ania' })).toBe(true);
  });

  it('lists the prolific authors apart, everyone by name, or the matches of a typed name', () => {
    const many = Array.from({ length: PROLIFIC_AUTHOR_MIN_MAPS }, (_, i) =>
      mapEntry(`cn-z${i}`, { author: 'Zenon' }),
    );
    const authors = authorCounts(rowsOf([...entries, ...many]), compare);
    const names = (list: readonly { readonly name: string }[]) => list.map((author) => author.name);
    expect(authors.map(({ name, count }) => [name, count])).toEqual([
      ['Zenon', PROLIFIC_AUTHOR_MIN_MAPS],
      ['Ania', 4],
      ['Bartek', 1],
      ['Żółw', 1],
    ]);
    const groups = authorListing(authors, '', compare);
    if (groups.kind !== 'groups') throw new Error('expected the two groups');
    expect(names(groups.top)).toEqual(['Zenon']);
    expect(names(groups.all)).toEqual(['Ania', 'Bartek', 'Zenon', 'Żółw']);
    const matches = (typed: string) => {
      const listing = authorListing(authors, typed, compare);
      if (listing.kind !== 'matches') throw new Error('expected matches');
      return names(listing.matches);
    };
    expect(matches(' ZOL')).toEqual(['Żółw']);
    expect(matches('a')).toEqual(['Ania', 'Bartek']);
    expect(matches('lw zo')).toEqual(['Żółw']);
    expect(matches('qq')).toEqual([]);
  });
});

describe('catalogue formatting', () => {
  it('names a byte count in the largest whole unit', () => {
    expect(formatBytes(512, 'en')).toBe('512 byte');
    expect(formatBytes(3 * KIB + KIB / 2, 'en')).toBe('3.5 kB');
    expect(formatBytes(5 * KIB * KIB, 'en')).toBe('5 MB');
    expect(formatBytes(5 * KIB * KIB, 'pl')).toBe('5 MB');
    expect(languageCodes(['pol', 'eng'])).toBe('PL EN');
  });
});
