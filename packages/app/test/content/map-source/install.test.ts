import { CATALOG_GAME_VERSION_HEADER, catalogBrowseEntry, type MapTextLanguage } from '@open-northland/data';
import { IR_VERSION } from '@open-northland/data/ir-version';
import { encodePng } from '@open-northland/formats/png';
import { describe, expect, it, vi } from 'vitest';
import {
  apiBase,
  apiBaseUrl,
  CatalogInstallError,
  createInstalledMapStore,
  DEFAULT_API_URL,
  fetchCatalog,
  installAnnouncedCatalogMap,
  installCatalogEntry,
} from '../../../src/content/map-source/index.js';
import {
  MAX_BRIEFING_VOICE_BYTES,
  MAX_BRIEFING_VOICES_BYTES,
} from '../../../src/content/map-source/install.js';
import {
  API,
  catalogEntry,
  catalogServer,
  memoryInstalledStorage,
  TINY_FINGERPRINT,
} from '../../support/catalog-maps.js';

const PNG = await encodePng({ width: 1, height: 1, rgba: new Uint8Array([0, 0, 0, 255]) });

const PCM_16_BIT = 16;
const PCM_24_BIT = 24;
/** The RIFF id and size, then the canonical 36 bytes of `WAVE`, `fmt ` and the `data` chunk head. */
const RIFF_HEAD_BYTES = 8;
const WAV_HEADER_BYTES = 44;
const WAVE_FORMAT_PCM = 1;
const MONO = 1;
const RATE = 22050;
const FMT_BYTES = 16;
const BITS_PER_BYTE = 8;

/** A mono PCM wav of `frames` silent samples. */
function wav(frames: number, bits = PCM_16_BIT): Uint8Array {
  const dataBytes = frames * (bits / BITS_PER_BYTE);
  const bytes = new Uint8Array(WAV_HEADER_BYTES + dataBytes);
  const view = new DataView(bytes.buffer);
  const ascii = (at: number, text: string): void => {
    for (const [i, c] of [...text].entries()) view.setUint8(at + i, c.charCodeAt(0));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, bytes.length - RIFF_HEAD_BYTES, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, FMT_BYTES, true);
  view.setUint16(20, WAVE_FORMAT_PCM, true);
  view.setUint16(22, MONO, true);
  view.setUint32(24, RATE, true);
  view.setUint16(32, bits / BITS_PER_BYTE, true);
  view.setUint16(34, bits, true);
  ascii(36, 'data');
  view.setUint32(40, dataBytes, true);
  return bytes;
}

/** A body of `size` bytes streamed in one reused chunk, so a test can exceed a cap without holding it. */
function streamed(size: number): Response {
  const CHUNK = 1024 * 1024;
  const chunk = new Uint8Array(CHUNK);
  let left = size;
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        if (left <= 0) {
          controller.close();
          return;
        }
        controller.enqueue(left >= CHUNK ? chunk : chunk.subarray(0, left));
        left -= CHUNK;
      },
    }),
  );
}

/** An entry whose map's briefing speaks Polish clips `ids` and lists `listed` of them as converted. */
function voicedEntry(id: string, ids: readonly number[], listed: readonly number[]) {
  const VOICE_CALLBACK = 2000;
  const suffix = (clip: number): string => `.voice-pol-${String(clip).padStart(4, '0')}.wav`;
  const base = catalogEntry(id);
  if (base.conversion?.verdict !== 'ok') throw new Error('fixture');
  const entry = {
    ...base,
    conversion: {
      ...base.conversion,
      maps: base.conversion.maps.map((map) => ({
        ...map,
        index: { ...map.index, voices: listed.map(suffix) },
      })),
    },
  };
  const briefing = {
    texts: { pol: { '500': ids.map((clip) => ({ kind: 'callback', args: [VOICE_CALLBACK, clip, 0] })) } },
  };
  return { entry, briefing, suffix };
}

function store() {
  const memory = memoryInstalledStorage();
  return { ...memory, store: createInstalledMapStore(memory.storage, { budget: null }) };
}

describe('the catalogue server address', () => {
  it('takes ?api= over the build default and refuses what is not a web address', () => {
    expect(apiBase('http://127.0.0.1:8790/')).toBe('http://127.0.0.1:8790');
    expect(apiBase('https://api.example.org/base//')).toBe('https://api.example.org/base');
    expect(apiBase('file:///etc')).toBeNull();
    expect(apiBase('https://x.org/?a=1')).toBeNull();
    expect(apiBase('')).toBeNull();
    expect(apiBaseUrl('?api=http%3A%2F%2F127.0.0.1%3A8790')).toBe('http://127.0.0.1:8790');
    expect(apiBaseUrl('?api=javascript:alert(1)')).toBe(DEFAULT_API_URL);
    expect(apiBaseUrl('')).toBe(DEFAULT_API_URL);
  });

  it('lists the entries this build reads and fails loudly when the server does not answer', async () => {
    const entry = catalogEntry('cn-a');
    const server: typeof fetch = async () =>
      Response.json([catalogBrowseEntry(entry), { id: 'cn-new-shape' }]);
    const listing = await fetchCatalog(API, server);
    expect(listing.entries.map((item) => item.id)).toEqual(['cn-a']);
    expect(listing.gameVersion).toBeNull();
    await expect(fetchCatalog(API, async () => new Response(null, { status: 503 }))).rejects.toThrow(/503/);
  });

  it('reads the release the server converts for, and drops a header that is no version', async () => {
    const named =
      (value: string): typeof fetch =>
      async () =>
        Response.json([], { headers: { [CATALOG_GAME_VERSION_HEADER]: value } });
    expect((await fetchCatalog(API, named('0.8.0'))).gameVersion).toBe('0.8.0');
    expect((await fetchCatalog(API, named('<html>oops</html>'))).gameVersion).toBeNull();
  });
});

describe('installing a catalogue entry', () => {
  it('requires referenced pictures and refuses invalid PNGs without committing a partial pack', async () => {
    const entry = catalogEntry('cn-picture');
    const { store: target, records, files } = store();
    const suffix = '.pictures-0123456789abcdef.png';
    const picture = { kind: 'picture', file: '0123456789abcdef.png', width: 3, height: 2 };
    const server = catalogServer([entry], {
      'cn-picture.briefing.json': { texts: { pol: { '500': [picture, picture] } } },
    });
    await expect(installCatalogEntry(entry, { api: API, store: target, fetchImpl: server })).rejects.toThrow(
      /404/,
    );
    expect(records.size).toBe(0);
    const invalid: typeof fetch = async (input) =>
      String(input).endsWith(suffix) ? new Response('not a PNG') : server(input);
    await expect(installCatalogEntry(entry, { api: API, store: target, fetchImpl: invalid })).rejects.toThrow(
      /PNG/,
    );
    expect(records.size).toBe(0);
    let images = 0;
    const valid: typeof fetch = async (input) => {
      if (!String(input).endsWith(suffix)) return server(input);
      images++;
      return new Response(new Uint8Array(PNG));
    };
    const progress = vi.fn();
    await installCatalogEntry(entry, { api: API, store: target, fetchImpl: valid, onProgress: progress });
    expect(images).toBe(1);
    expect(files.get(`cn-picture${suffix}`)).toEqual(new Uint8Array(PNG));
    expect(progress).toHaveBeenLastCalledWith({ done: 7, total: 7 });
  });

  it('stops sibling downloads and progress after a failed attempt so it can be retried', async () => {
    const entry = catalogEntry('cn-a');
    const { store: target, records } = store();
    const progress = vi.fn();
    let releaseRemaining = () => {};
    const remaining = new Promise<void>((resolve) => {
      releaseRemaining = resolve;
    });
    const signals: AbortSignal[] = [];
    const server: typeof fetch = async (input, init) => {
      if (init?.signal !== undefined && init.signal !== null) signals.push(init.signal);
      if (String(input).endsWith('/cn-a.json')) return new Response(null, { status: 500 });
      await remaining;
      return new Response(null, { status: 404 });
    };
    await expect(
      installCatalogEntry(entry, { api: API, store: target, fetchImpl: server, onProgress: progress }),
    ).rejects.toThrow(/500/);
    expect(signals).toHaveLength(6);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    const callsAfterFailure = progress.mock.calls.length;
    releaseRemaining();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(progress).toHaveBeenCalledTimes(callsAfterFailure);
    expect(records.size).toBe(0);
    await installCatalogEntry(entry, { api: API, store: target, fetchImpl: catalogServer([entry]) });
    expect([...records.keys()]).toEqual(['cn-a']);
  });

  it('does not commit an install cancelled after the final download', async () => {
    const entry = catalogEntry('cn-cancel');
    const { store: target, records } = store();
    const controller = new AbortController();
    await expect(
      installCatalogEntry(entry, {
        api: API,
        store: target,
        fetchImpl: catalogServer([entry]),
        signal: controller.signal,
        onProgress: ({ done, total }) => {
          if (done === total) controller.abort();
        },
      }),
    ).rejects.toThrow();
    expect(records.size).toBe(0);
  });

  it('stores a campaign with its sub maps, verified, and reports progress per file', async () => {
    const entry = catalogEntry('cn-pack', ['cn-pack', 'cn-pack-2']);
    const { store: target, records, files } = store();
    const progress = vi.fn();
    const server = catalogServer([entry], {
      'cn-pack.meta.json': { name: { pol: 'Zatoka' } },
      'cn-pack.png': PNG,
    });
    const pictureServer: typeof fetch = async (input) =>
      String(input).endsWith('cn-pack.png') ? new Response(new Uint8Array(PNG)) : server(input);
    const installed = await installCatalogEntry(entry, {
      api: API,
      store: target,
      fetchImpl: pictureServer,
      onProgress: progress,
      now: () => 5,
    });
    expect(installed.map((item) => [item.mapId, item.fingerprint, item.irVersion, item.suffixes])).toEqual([
      ['cn-pack', TINY_FINGERPRINT, IR_VERSION, ['.json', '.meta.json', '.png']],
      ['cn-pack-2', TINY_FINGERPRINT, IR_VERSION, ['.json']],
    ]);
    expect(installed[0]?.index.provenance).toEqual({ kind: 'catalog', folder: 'cn-pack' });
    expect([...records.keys()]).toEqual(['cn-pack', 'cn-pack-2']);
    expect(files.has('cn-pack.png')).toBe(true);
    expect(progress).toHaveBeenLastCalledWith({ done: 12, total: 12 });
  });

  it('records the languages the catalogue lists, the ones an update compares', async () => {
    const base = catalogEntry('cn-tr');
    if (base.conversion?.verdict !== 'ok') throw new Error('fixture');
    const languages: MapTextLanguage[] = ['pol', 'chs'];
    const maps = base.conversion.maps.map((map) => ({ ...map, languages }));
    const entry = { ...base, conversion: { ...base.conversion, maps } };
    const { store: target } = store();
    const installed = await installCatalogEntry(entry, {
      api: API,
      store: target,
      fetchImpl: catalogServer([entry], {
        'cn-tr.strings.json': { pol: { '0': 'Wyspa' }, chs: { '0': '岛屿' } },
      }),
    });
    expect(installed.map((record) => record.languages)).toEqual([['pol', 'chs']]);
    expect((await target.list()).map((record) => record.languages)).toEqual([['pol', 'chs']]);
  });

  it('refuses a conversion for another game version, a mismatched fingerprint and a broken sidecar', async () => {
    const { store: target, records } = store();
    const other = catalogEntry('cn-a');
    if (other.conversion?.verdict !== 'ok') throw new Error('fixture');
    const older = { ...other, conversion: { ...other.conversion, irVersion: IR_VERSION - 1 } };
    await expect(
      installCatalogEntry(older, { api: API, store: target, fetchImpl: catalogServer([older]) }),
    ).rejects.toThrow(CatalogInstallError);
    const lying = {
      ...other,
      conversion: {
        ...other.conversion,
        maps: other.conversion.maps.map((map) => ({ ...map, fingerprint: 'e'.repeat(64) })),
      },
    };
    await expect(
      installCatalogEntry(lying, { api: API, store: target, fetchImpl: catalogServer([lying]) }),
    ).rejects.toThrow(/fingerprint/);
    const broken = catalogServer([other], { 'cn-a.strings.json': { pol: 'not a table' } });
    await expect(installCatalogEntry(other, { api: API, store: target, fetchImpl: broken })).rejects.toThrow(
      /build/,
    );
    const pending = catalogEntry('cn-p', [], { conversion: { verdict: 'pending' } });
    await expect(
      installCatalogEntry(pending, { api: API, store: target, fetchImpl: catalogServer([]) }),
    ).rejects.toThrow(/no converted maps/);
    expect(records.size).toBe(0);
  });

  it('stores only the listed voices the server has and the narration plays, and lists only those', async () => {
    const { entry, briefing, suffix } = voicedEntry('cn-voiced', [1, 2, 3, 4], [1, 2, 3]);
    const { store: target, files } = store();
    const documents = catalogServer([entry], { 'cn-voiced.briefing.json': briefing });
    const asked: string[] = [];
    const server: typeof fetch = async (input) => {
      const url = String(input);
      if (!url.endsWith('.wav')) return documents(input);
      asked.push(url.slice(url.lastIndexOf('.voice')));
      if (url.endsWith(suffix(1))) return new Response(new Uint8Array(wav(4)));
      if (url.endsWith(suffix(2))) return new Response(new Uint8Array(wav(4, PCM_24_BIT)));
      return new Response(null, { status: 404 });
    };
    const [record] = await installCatalogEntry(entry, { api: API, store: target, fetchImpl: server });
    expect(asked).toEqual([suffix(1), suffix(2), suffix(3)]);
    expect(record?.index.voices).toEqual([suffix(1)]);
    expect(record?.suffixes).toContain(suffix(1));
    expect(record?.suffixes).not.toContain(suffix(2));
    expect(files.has(`cn-voiced${suffix(1)}`)).toBe(true);
    expect(files.has(`cn-voiced${suffix(2)}`)).toBe(false);
  });

  it('refuses a voice past the clip cap and voices past the map`s budget', async () => {
    const { entry, briefing } = voicedEntry('cn-loud', [1], [1]);
    const documents = catalogServer([entry], { 'cn-loud.briefing.json': briefing });
    const declared: typeof fetch = async (input) =>
      String(input).endsWith('.wav')
        ? new Response(new Uint8Array(wav(4)), {
            headers: { 'content-length': String(MAX_BRIEFING_VOICE_BYTES + 1) },
          })
        : documents(input);
    await expect(
      installCatalogEntry(entry, { api: API, store: store().store, fetchImpl: declared }),
    ).rejects.toThrow(/size limit/);
    const long: typeof fetch = async (input) =>
      String(input).endsWith('.wav') ? streamed(MAX_BRIEFING_VOICE_BYTES + 1) : documents(input);
    await expect(
      installCatalogEntry(entry, { api: API, store: store().store, fetchImpl: long }),
    ).rejects.toThrow(/size limit/);

    const clips = Math.floor(MAX_BRIEFING_VOICES_BYTES / MAX_BRIEFING_VOICE_BYTES) + 1;
    const ids = Array.from({ length: clips }, (_, i) => i + 1);
    const many = voicedEntry('cn-many', ids, ids);
    const manyDocuments = catalogServer([many.entry], { 'cn-many.briefing.json': many.briefing });
    const budget: typeof fetch = async (input) =>
      String(input).endsWith('.wav') ? streamed(MAX_BRIEFING_VOICE_BYTES) : manyDocuments(input);
    const { store: target, records } = store();
    await expect(
      installCatalogEntry(many.entry, { api: API, store: target, fetchImpl: budget }),
    ).rejects.toThrow(/briefing voices exceed the size limit/);
    expect(records.size).toBe(0);
  });

  it("fetches a room's announced map only when the server has that exact conversion", async () => {
    const entry = catalogEntry('cn-a');
    const announced = {
      entryId: 'cn-a',
      mapId: 'cn-a',
      fingerprint: TINY_FINGERPRINT,
      irVersion: IR_VERSION,
    };
    const services = { api: API, fetchImpl: catalogServer([entry]) };
    const { store: target } = store();
    expect((await installAnnouncedCatalogMap(announced, { ...services, store: target }))?.fingerprint).toBe(
      TINY_FINGERPRINT,
    );
    expect(
      await installAnnouncedCatalogMap(
        { ...announced, fingerprint: 'e'.repeat(64) },
        { ...services, store: store().store },
      ),
    ).toBeNull();
    expect(
      await installAnnouncedCatalogMap(
        { ...announced, irVersion: IR_VERSION + 1 },
        { ...services, store: store().store },
      ),
    ).toBeNull();
    expect(await installAnnouncedCatalogMap(announced, { ...services, store: null })).toBeNull();
  });
});
