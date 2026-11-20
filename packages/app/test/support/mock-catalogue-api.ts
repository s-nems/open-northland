/**
 * A stand-in for the map catalogue API with synthetic entries that exercise every sort, filter and
 * state of the catalogue view. A test tool, not a dev dependency:
 *
 *   npx tsc --build packages/data
 *   PORT=8797 ON_CONTENT_DIR=content node packages/app/test/support/mock-catalogue-api.ts
 *
 * With `ON_CONTENT_DIR` each converted map is a copy of a shipped map from that content tree, so it
 * installs and plays; without it every map is a one-cell terrain. `POST /mock/republish/<entry id>`
 * gives an entry's maps a new conversion, which an installed copy then shows as an update.
 * `/v1/maps/<id>/file` serves a placeholder for the file an entry's `file.path` names.
 */
import { closeSync, existsSync, openSync, readFileSync, readSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import {
  type CatalogConvertedMap,
  type CatalogEntry,
  type CatalogKind,
  catalogBrowseEntry,
  EMPTY_NEWS_DOCUMENT,
  type MapsIndexEntry,
  type MapsIndexPlayerSlot,
  type MapTextLanguage,
  mapDocumentsFingerprint,
  RELEASE_FEED_SCHEMA_VERSION,
  type ReleaseFeed,
} from '@open-northland/data';
import { IR_VERSION } from '@open-northland/data/ir-version';

const DEFAULT_PORT = 8797;
const SIDECARS = ['.json', '.meta.json', '.script.json', '.strings.json', '.briefing.json', '.png'];
/** The terrain files open with their width and height; this many bytes always hold both. */
const TERRAIN_HEAD_BYTES = 256;
const BYTES_PER_MB = 1024 * 1024;
/** The campaign slot a pack's sub maps carry, as a converted campaign's do. */
const MOCK_CAMPAIGN_ID = 7;
/** Answers the menu's release feed as well, for a page that names this server with `?site=`. */
const EMPTY_RELEASE_FEED: ReleaseFeed = {
  schema: RELEASE_FEED_SCHEMA_VERSION,
  download: { en: 'https://example.org/download/' },
  releases: [],
};

interface MapSpec {
  /** The seats the map offers; steers which shipped map a content-backed copy takes. */
  readonly players: number;
  /** The side of a square map, in cells; steers the copy the same way. */
  readonly side: number;
}

interface EntrySpec {
  readonly id: string;
  readonly title: string;
  readonly author: string;
  readonly kind: CatalogKind;
  readonly series?: boolean;
  readonly categoryLabel: string;
  readonly likes: number;
  readonly downloads: number;
  readonly published: string;
  readonly updated?: string;
  readonly languages: readonly MapTextLanguage[];
  readonly maps: readonly MapSpec[];
  readonly megabytes?: number;
  readonly version?: string;
  readonly description?: string;
  /** How the server got on with the entry; `ok` by default. `failed` lost the download and kept no
   *  file, `manual` kept a file it could not unpack, `mapless` kept an archive that holds no map. */
  readonly state?: 'ok' | 'pending' | 'failed' | 'manual' | 'mapless' | 'external' | 'newer' | 'older';
}

/** The failure each failed state reports. */
const FAILURES = {
  failed: { reason: 'download-failed', message: 'upstream answered 404' },
  manual: { reason: 'unsupported-archive', message: 'the rar archive is password-protected' },
  mapless: { reason: 'no-map', message: 'the archive holds no Cultures 2 map' },
} as const;

/** The placeholder bytes the mock serves as a kept file. */
const KEPT_FILE_BODY = 'mock archive';

const CATEGORY = {
  single: 'Mapy singleplayer',
  multi: 'Mapy multiplayer',
  campaign: 'Kampanie',
  seriesSingle: 'Mapy z serii Cultures - singleplayer',
  seriesMulti: 'Mapy z serii Cultures - multiplayer',
  other: 'Inne mapy',
} as const;

const SPECS: readonly EntrySpec[] = [
  {
    id: 'cn-burza',
    title: 'Burza piaskowa',
    author: 'Mirek',
    kind: 'multi',
    categoryLabel: CATEGORY.multi,
    likes: 48,
    downloads: 1200,
    published: '2023-04-02',
    updated: '2025-11-20',
    languages: ['pol', 'eng'],
    maps: [{ players: 4, side: 250 }],
    megabytes: 2.4,
    version: '1.3 (2,4 MB)',
    description:
      'Pustynna mapa dla czterech graczy.\n\nKażdy zaczyna przy własnej oazie,\na środek mapy kryje złoto.',
  },
  {
    id: 'cn-diament',
    title: 'Diamentowa dolina',
    author: 'Ania',
    kind: 'single',
    categoryLabel: CATEGORY.single,
    likes: 35,
    downloads: 2100,
    published: '2021-08-15',
    languages: ['pol'],
    maps: [{ players: 1, side: 180 }],
    megabytes: 1.1,
    version: '1.0',
    description: 'Spokojna rozbudowa w zielonej dolinie.',
  },
  {
    id: 'cn-saga',
    title: 'Saga o Bjarnim',
    author: 'Ania',
    kind: 'campaign',
    categoryLabel: CATEGORY.campaign,
    likes: 61,
    downloads: 900,
    published: '2024-02-10',
    updated: '2026-03-01',
    languages: ['pol', 'eng', 'ger'],
    maps: [
      { players: 2, side: 180 },
      { players: 2, side: 120 },
      { players: 3, side: 250 },
    ],
    megabytes: 6.8,
    version: '2.0',
    description: 'Kampania w trzech rozdziałach.\nRozdział pierwszy: wyprawa.\nRozdział drugi: zima.',
  },
  {
    id: 'cn-wyspy',
    title: 'Wyspy Północy',
    author: 'Thorgal',
    kind: 'multi',
    series: true,
    categoryLabel: CATEGORY.seriesMulti,
    likes: 12,
    downloads: 300,
    published: '2019-05-01',
    languages: ['eng'],
    maps: [{ players: 6, side: 100 }],
    megabytes: 0.8,
  },
  {
    id: 'cn-twierdza',
    title: 'Twierdza',
    author: 'Bartek',
    kind: 'single',
    series: true,
    categoryLabel: CATEGORY.seriesSingle,
    likes: 7,
    downloads: 150,
    published: '2020-10-12',
    languages: ['ger'],
    maps: [{ players: 2, side: 250 }],
    megabytes: 1.6,
    description: 'Eine Festung im Gebirge.',
  },
  {
    id: 'cn-turniej',
    title: 'Turniej czterech klanów',
    author: 'Mirek',
    kind: 'multi',
    categoryLabel: CATEGORY.multi,
    likes: 22,
    downloads: 640,
    published: '2025-01-05',
    languages: ['pol', 'rus'],
    maps: [{ players: 4, side: 180 }],
    megabytes: 1.9,
  },
  {
    id: 'cn-zima',
    title: 'Mroźna zima',
    author: 'Kasia',
    kind: 'multi',
    categoryLabel: CATEGORY.multi,
    likes: 3,
    downloads: 40,
    published: '2026-09-01',
    updated: '2026-10-01',
    languages: ['rus'],
    maps: [{ players: 2, side: 100 }],
  },
  {
    id: 'cn-scenariusze',
    title: 'Zestaw scenariuszy',
    author: 'Kasia',
    kind: 'other',
    categoryLabel: CATEGORY.other,
    likes: 9,
    downloads: 210,
    published: '2022-12-24',
    languages: ['pol'],
    maps: [{ players: 3, side: 120 }],
    megabytes: 0.5,
    description: 'Kilka krótkich scenariuszy do sprawdzenia na szybko.',
  },
  {
    id: 'cn-czeka',
    title: 'Czeka na serwer',
    author: 'Bartek',
    kind: 'single',
    categoryLabel: CATEGORY.single,
    likes: 1,
    downloads: 5,
    published: '2026-10-09',
    languages: [],
    maps: [],
    state: 'pending',
  },
  {
    id: 'cn-zepsuta',
    title: 'Zepsuta mapa',
    author: 'Thorgal',
    kind: 'multi',
    categoryLabel: CATEGORY.multi,
    likes: 2,
    downloads: 80,
    published: '2018-03-03',
    languages: [],
    maps: [],
    state: 'failed',
  },
  {
    id: 'cn-grobowiec',
    title: 'Grobowiec Króla',
    author: 'Kasia',
    kind: 'single',
    categoryLabel: CATEGORY.single,
    likes: 11,
    downloads: 320,
    published: '2016-06-06',
    languages: [],
    maps: [],
    megabytes: 3.2,
    state: 'manual',
  },
  {
    id: 'cn-norwegia',
    title: 'The King of Norway',
    author: 'Thorgal',
    kind: 'single',
    categoryLabel: CATEGORY.single,
    likes: 8,
    downloads: 90,
    published: '2015-05-05',
    languages: [],
    maps: [],
    megabytes: 0.4,
    state: 'mapless',
  },
  {
    id: 'cn-gdzie-indziej',
    title: 'Mapa na innej stronie',
    author: 'Mirek',
    kind: 'single',
    series: true,
    categoryLabel: CATEGORY.seriesSingle,
    likes: 15,
    downloads: 0,
    published: '2017-07-07',
    languages: [],
    maps: [],
    state: 'external',
  },
  {
    id: 'cn-nowsza',
    title: 'Dla nowszej gry',
    author: 'Ania',
    kind: 'multi',
    categoryLabel: CATEGORY.multi,
    likes: 4,
    downloads: 20,
    published: '2026-10-10',
    languages: ['pol'],
    maps: [{ players: 2, side: 120 }],
    state: 'newer',
  },
  {
    id: 'cn-starsza',
    title: 'Dla starszej gry',
    author: 'Bartek',
    kind: 'multi',
    categoryLabel: CATEGORY.multi,
    likes: 6,
    downloads: 60,
    published: '2022-02-02',
    languages: ['eng'],
    maps: [{ players: 2, side: 180 }],
    state: 'older',
  },
];

/** The one-cell terrain a map without content serves; `typeIds` differs per conversion revision. */
const tinyTerrain = (revision: number) => ({ width: 1, height: 1, typeIds: [revision] });

const iso = (day: string): string => `${day}T12:00:00.000Z`;

/** `count` claimable human seats, one colour each. */
export function seats(count: number): MapsIndexPlayerSlot[] {
  return Array.from({ length: count }, (_, player) => ({
    player,
    type: 'human',
    tribeId: 1,
    colorId: player,
    claimable: true,
    hidden: false,
    aiAllowed: true,
    noneAllowed: true,
    hasComputerControl: true,
  }));
}

interface ShippedMap {
  readonly row: MapsIndexEntry;
  readonly width: number;
  readonly height: number;
}

function terrainSize(file: string): { width: number; height: number } | null {
  const fd = openSync(file, 'r');
  try {
    const head = Buffer.alloc(TERRAIN_HEAD_BYTES);
    readSync(fd, head, 0, TERRAIN_HEAD_BYTES, 0);
    const text = head.toString('utf8');
    const width = /"width":(\d+)/.exec(text)?.[1];
    const height = /"height":(\d+)/.exec(text)?.[1];
    return width === undefined || height === undefined
      ? null
      : { width: Number(width), height: Number(height) };
  } finally {
    closeSync(fd);
  }
}

function shippedMaps(contentDir: string): readonly ShippedMap[] {
  const rows = JSON.parse(readFileSync(join(contentDir, 'maps-index.json'), 'utf8')) as MapsIndexEntry[];
  return rows.flatMap((row) => {
    const file = join(contentDir, 'maps', `${row.id}.json`);
    const size = existsSync(file) && row.campaign === undefined ? terrainSize(file) : null;
    return size === null ? [] : [{ row, ...size }];
  });
}

const listedSeats = (row: MapsIndexEntry): number => row.players?.filter((slot) => !slot.hidden).length ?? 0;

/** The shipped map closest to `spec`, a matching seat count first; `skip` steps to the next best. */
function closest(maps: readonly ShippedMap[], spec: MapSpec, skip: number): ShippedMap {
  const area = spec.side * spec.side;
  const ranked = [...maps].sort(
    (a, b) =>
      Number(listedSeats(b.row) === spec.players) - Number(listedSeats(a.row) === spec.players) ||
      Math.abs(a.width * a.height - area) - Math.abs(b.width * b.height - area) ||
      (a.row.id < b.row.id ? -1 : 1),
  );
  const pick = ranked[skip % ranked.length];
  if (pick === undefined) throw new Error('the content tree lists no map to copy');
  return pick;
}

export interface MockCatalogueOptions {
  readonly irVersion: number;
  /** A content tree whose shipped maps the converted maps copy; null serves one-cell terrains. */
  readonly contentDir: string | null;
}

/** The synthetic catalogue and the files behind it. */
export function mockCatalogue(options: MockCatalogueOptions) {
  const shipped = options.contentDir === null ? [] : shippedMaps(options.contentDir);
  /** Conversion revision per entry id; `republish` raises it. */
  const revisions = new Map<string, number>();
  /** Catalogue map id to the shipped map it copies, or null for a one-cell terrain. */
  const sources = new Map<string, { readonly shippedId: string | null; readonly revision: number }>();

  const convertedMap = (
    spec: EntrySpec,
    map: MapSpec,
    index: number,
    revision: number,
  ): CatalogConvertedMap => {
    const mapId = index === 0 ? spec.id : `${spec.id}-${index + 1}`;
    const campaign = index === 0 ? {} : { campaign: { campaignId: MOCK_CAMPAIGN_ID, missionId: index + 1 } };
    if (options.contentDir === null) {
      sources.set(mapId, { shippedId: null, revision });
      const fingerprint = mapDocumentsFingerprint({ map: tinyTerrain(revision), script: null });
      return {
        mapId,
        folder: mapId,
        fingerprint,
        languages: [...spec.languages],
        cells: { width: map.side, height: map.side },
        index: {
          id: mapId,
          fingerprint,
          picture: false,
          minimap: false,
          players: seats(map.players),
          ...campaign,
        },
      };
    }
    const copy = closest(shipped, map, index + revision);
    sources.set(mapId, { shippedId: copy.row.id, revision });
    const terrain: unknown = JSON.parse(
      readFileSync(join(options.contentDir, 'maps', `${copy.row.id}.json`), 'utf8'),
    );
    const scriptFile = join(options.contentDir, 'maps', `${copy.row.id}.script.json`);
    const script: unknown = existsSync(scriptFile) ? JSON.parse(readFileSync(scriptFile, 'utf8')) : null;
    const { campaign: _shippedCampaign, ...row } = copy.row;
    const fingerprint = mapDocumentsFingerprint({ map: terrain, script });
    return {
      mapId,
      folder: mapId,
      fingerprint,
      languages: [...spec.languages],
      cells: { width: copy.width, height: copy.height },
      index: {
        ...row,
        id: mapId,
        fingerprint,
        minimap: false,
        provenance: { kind: 'catalog', folder: `Maps/${copy.row.id}` },
        ...campaign,
      },
    };
  };

  const entry = (spec: EntrySpec): CatalogEntry => {
    const revision = revisions.get(spec.id) ?? 0;
    const state = spec.state ?? 'ok';
    const irVersion =
      state === 'newer'
        ? options.irVersion + 1
        : state === 'older'
          ? options.irVersion - 1
          : options.irVersion;
    const hasPicture = options.contentDir !== null && spec.maps.length > 0;
    // The server keeps a file it fetched, but the one whose download failed.
    const kept = state !== 'failed' && state !== 'pending' && spec.megabytes !== undefined;
    return {
      id: spec.id,
      source: {
        documentId: `doc-${spec.id}`,
        id: SPECS.indexOf(spec) + 1,
        page: `https://culturesnation.pl/downloads/doc-${spec.id}/${spec.id}`,
      },
      title: spec.title,
      shortDescription: spec.description?.split('\n')[0] ?? '',
      fullDescription: spec.description ?? '',
      author: spec.author,
      kind: spec.kind,
      series: spec.series === true,
      categoryLabel: spec.categoryLabel,
      publishedAt: iso(spec.published),
      updatedAt: revision > 0 ? new Date().toISOString() : iso(spec.updated ?? spec.published),
      downloadCount: spec.downloads,
      likeCount: spec.likes,
      ...(spec.version === undefined ? {} : { versionText: spec.version }),
      ...(hasPicture ? { thumbnail: `/v1/maps/${spec.id}/thumbnail` } : {}),
      file:
        state === 'external'
          ? { kind: 'external', url: 'https://example.org/some-map' }
          : {
              kind: 'archive',
              ...(spec.megabytes === undefined ? {} : { bytes: Math.round(spec.megabytes * BYTES_PER_MB) }),
              ...(kept ? { path: `/v1/maps/${spec.id}/file` } : {}),
            },
      ...(state === 'external'
        ? {}
        : state === 'pending'
          ? { conversion: { verdict: 'pending' as const } }
          : state === 'failed' || state === 'manual' || state === 'mapless'
            ? { conversion: { verdict: 'failed' as const, ...FAILURES[state] } }
            : {
                conversion: {
                  verdict: 'ok' as const,
                  irVersion,
                  maps: spec.maps.map((map, index) => convertedMap(spec, map, index, revision)),
                },
              }),
    };
  };

  let entries = SPECS.map(entry);
  return {
    get entries(): readonly CatalogEntry[] {
      return entries;
    },
    republish(entryId: string): boolean {
      const spec = SPECS.find((item) => item.id === entryId);
      if (spec === undefined) return false;
      revisions.set(entryId, (revisions.get(entryId) ?? 0) + 1);
      entries = SPECS.map(entry);
      return true;
    },
    /** A served sidecar's bytes and type, or null. */
    sidecar(irVersion: number, mapId: string, suffix: string): { body: Buffer; type: string } | null {
      const source = sources.get(mapId);
      if (source === undefined || !SIDECARS.includes(suffix)) return null;
      const served = entries.some(
        (item) =>
          item.conversion?.verdict === 'ok' &&
          item.conversion.irVersion === irVersion &&
          item.conversion.maps.some((map) => map.mapId === mapId),
      );
      if (!served) return null;
      const type = suffix === '.png' ? 'image/png' : 'application/json';
      if (source.shippedId === null || options.contentDir === null)
        return suffix === '.json'
          ? { body: Buffer.from(JSON.stringify(tinyTerrain(source.revision))), type }
          : null;
      const file = join(options.contentDir, 'maps', `${source.shippedId}${suffix}`);
      return existsSync(file) ? { body: readFileSync(file), type } : null;
    },
    /** The kept file an entry's `file.path` names, or null. */
    keptFile(entryId: string): Buffer | null {
      const found = entries.find((item) => item.id === entryId);
      return found?.file.kind !== 'external' && found?.file.path !== undefined
        ? Buffer.from(KEPT_FILE_BODY)
        : null;
    },
    thumbnail(entryId: string): Buffer | null {
      const found = entries.find((item) => item.id === entryId);
      const main = found?.conversion?.verdict === 'ok' ? found.conversion.maps[0] : undefined;
      const source = main === undefined ? undefined : sources.get(main.mapId);
      if (source === undefined || source.shippedId === null || options.contentDir === null) return null;
      const file = join(options.contentDir, 'maps', `${source.shippedId}.png`);
      return existsSync(file) ? readFileSync(file) : null;
    },
  };
}

function serve(port: number, catalogue: ReturnType<typeof mockCatalogue>): void {
  const cors = { 'access-control-allow-origin': '*' };
  createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://mock');
    const send = (status: number, body: string | Buffer, type = 'application/json'): void => {
      response.writeHead(status, { ...cors, 'content-type': type });
      response.end(body);
    };
    const republish = /^\/mock\/republish\/([^/]+)$/.exec(url.pathname);
    if (republish !== null && request.method === 'POST')
      return send(catalogue.republish(republish[1] ?? '') ? 200 : 404, '{}');
    if (url.pathname === '/v1/catalog')
      return send(200, JSON.stringify(catalogue.entries.map(catalogBrowseEntry)));
    if (url.pathname === '/v1/news') return send(200, JSON.stringify(EMPTY_NEWS_DOCUMENT));
    if (url.pathname === '/releases/feed.json') return send(200, JSON.stringify(EMPTY_RELEASE_FEED));
    const thumbnail = /^\/v1\/maps\/([^/]+)\/thumbnail$/.exec(url.pathname);
    if (thumbnail !== null) {
      const png = catalogue.thumbnail(thumbnail[1] ?? '');
      return png === null ? send(404, '{"error":"no thumbnail"}') : send(200, png, 'image/png');
    }
    const kept = /^\/v1\/maps\/([^/]+)\/file$/.exec(url.pathname);
    if (kept !== null) {
      const body = catalogue.keptFile(kept[1] ?? '');
      return body === null ? send(404, '{"error":"no file"}') : send(200, body, 'application/octet-stream');
    }
    const single = /^\/v1\/maps\/([^/]+)$/.exec(url.pathname);
    if (single !== null) {
      const found = catalogue.entries.find((item) => item.id === single[1]);
      return found === undefined ? send(404, '{"error":"unknown"}') : send(200, JSON.stringify(found));
    }
    const file = /^\/v1\/content\/(\d+)\/maps\/([a-z0-9_-]+)(\.[a-z.]+)$/i.exec(url.pathname);
    if (file !== null) {
      const found = catalogue.sidecar(Number(file[1]), file[2] ?? '', file[3] ?? '');
      return found === null ? send(404, '{"error":"absent"}') : send(200, found.body, found.type);
    }
    send(404, '{"error":"not found"}');
  }).listen(port, '127.0.0.1', () => {
    process.stdout.write(`mock catalogue API on http://127.0.0.1:${port}\n`);
  });
}

if (import.meta.main) {
  const contentDir = process.env.ON_CONTENT_DIR;
  serve(
    Number(process.env.PORT ?? DEFAULT_PORT),
    mockCatalogue({
      irVersion: Number(process.env.MOCK_IR ?? IR_VERSION),
      contentDir: contentDir === undefined ? null : resolve(contentDir),
    }),
  );
}
