import { IR_VERSION } from '@open-northland/data/ir-version';
import { encodePcx } from '@open-northland/formats/pcx';
import { DEFAULT_IMPORT_LIMITS } from '@open-northland/map-import';
import { zipSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';
import { encodeC2m } from '../../../formats/test/fixtures/c2m.js';
import { rampPalette } from '../../../formats/test/fixtures/palette.js';
import { plaintextMap } from '../../../map-import/test/support/maps.js';
import { prepareLocalImport } from '../../src/content/local-import/convert.js';
import { checkedLocalInput, type LocalMapInput } from '../../src/content/local-import/input.js';
import { installLocalMap, reconvertLocalMap } from '../../src/content/local-import/install.js';
import { MapStorageFullError } from '../../src/content/map-source/installed.js';
import { createMapSourceRegistry } from '../../src/content/map-source/sources.js';
import { createInstalledMapStore } from '../../src/content/map-source/store.js';
import { subMissionPool } from '../../src/entries/map/sub-missions.js';
import { memoryInstalledStorage } from '../support/catalog-maps.js';

function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function bytes(name = 'Pierwsza') {
  return Object.fromEntries(
    Object.entries(plaintextMap(name)).map(([path, value]) => [
      path,
      typeof value === 'string' ? new TextEncoder().encode(value) : value,
    ]),
  );
}
function input(name = 'Pierwsza'): LocalMapInput {
  return { kind: 'archive', name: 'map.zip', file: new Blob([new Uint8Array(zipSync(bytes(name)))]) };
}
const convert = (
  request: Parameters<typeof import('../../src/content/local-import/client.js').convertLocalMap>[0],
) => prepareLocalImport(request.input, request);

describe('local conversion and retained sources', () => {
  it('imports synthetic ZIP, editor export and folder with user provenance', async () => {
    const files = bytes();
    const inputs: LocalMapInput[] = [
      input(),
      { kind: 'archive', name: 'map.c2m', file: new Blob([new Uint8Array(encodeC2m(files))]) },
      {
        kind: 'folder',
        name: 'map',
        files: Object.entries(files).map(([path, data]) => ({
          path,
          file: new Blob([new Uint8Array(data)]),
        })),
      },
    ];
    for (const source of inputs) {
      const result = await prepareLocalImport(source, { installedAt: 1 });
      expect(result.maps).toHaveLength(1);
      expect(result.maps[0]?.record.index.provenance?.kind).toBe('user');
      expect(JSON.parse(new TextDecoder().decode(result.maps[0]?.files.get('.json')))).toMatchObject({
        width: 2,
        height: 1,
      });
      expect(result.source.input).toEqual(checkedLocalInput(source));
    }
  });

  it('rejects folder paths and declared sizes before reading a blob', () => {
    const oversized = new Blob();
    Object.defineProperty(oversized, 'size', { value: DEFAULT_IMPORT_LIMITS.entryBytes + 1 });
    expect(() =>
      checkedLocalInput({ kind: 'folder', name: 'map', files: [{ path: 'map.dat', file: oversized }] }),
    ).toThrow(/limit/);
    expect(() =>
      checkedLocalInput({ kind: 'folder', name: 'map', files: [{ path: '../map.dat', file: new Blob() }] }),
    ).toThrow(/relative/);
  });

  it('refreshes text without duplicating the map and retains the latest input', async () => {
    const backing = memoryInstalledStorage();
    const store = createInstalledMapStore(backing.storage, { budget: null });
    const first = await installLocalMap(input(), { store, convert, now: () => 1 });
    const next = await installLocalMap(input('Druga'), { store, convert, now: () => 2 });
    expect(next.source.record.entryId).toBe(first.source.record.entryId);
    expect(next.source.record.fingerprint).not.toBe(first.source.record.fingerprint);
    expect((await store.list()).map((map) => map.mapId)).toEqual(first.maps.map((map) => map.record.mapId));
    expect((await store.readSource(first.source.record.entryId))?.record).toEqual(next.source.record);
  });

  it('rebuilds from retained input even when the old generated record cannot be parsed', async () => {
    const backing = memoryInstalledStorage();
    const store = createInstalledMapStore(backing.storage, { budget: null });
    const first = await installLocalMap(input(), { store, convert });
    const entryId = first.source.record.entryId;
    for (const map of first.maps)
      backing.records.set(map.record.mapId, { ...map.record, index: { obsolete: true } });
    expect(await store.list()).toEqual([]);
    const restored = await reconvertLocalMap(entryId, { store, convert });
    expect(restored.maps.map((map) => map.record.mapId)).toEqual(first.maps.map((map) => map.record.mapId));
    expect(restored.maps[0]?.record.irVersion).toBe(IR_VERSION);
    expect((await store.list()).every((record) => record.irVersion === IR_VERSION)).toBe(true);
    await store.remove(entryId);
    expect(await store.sources()).toEqual([]);
    expect(backing.files.size).toBe(0);
  });

  it('reads source metadata and input as one storage snapshot during replacement', async () => {
    const backing = memoryInstalledStorage();
    const store = createInstalledMapStore(backing.storage, { budget: null });
    const first = await installLocalMap(input(), { store, convert });
    const captured = deferred();
    const release = deferred();
    const reader = createInstalledMapStore(
      {
        ...backing.storage,
        readSource: async (entryId) => {
          const pair = await backing.storage.readSource(entryId);
          captured.resolve();
          await release.promise;
          return pair;
        },
      },
      { budget: null },
    );
    const reading = reader.readSource(first.source.record.entryId);
    await captured.promise;
    await installLocalMap(input('Replacement'), { store, convert });
    release.resolve();
    const retained = await reading;
    expect(retained?.record).toEqual(first.source.record);
    if (retained === null) throw new Error('Missing retained source');
    const rebuilt = await prepareLocalImport(retained.input, {
      previous: retained.record,
      installedAt: 3,
    });
    expect(rebuilt.source.record.fingerprint).toBe(first.source.record.fingerprint);
  });

  it('counts retained bytes, protects local entries and preserves the old pack on failure', async () => {
    const backing = memoryInstalledStorage();
    const prepared = await prepareLocalImport(input(), { installedAt: 1 });
    const cost = prepared.source.record.size + prepared.maps.reduce((sum, map) => sum + map.record.size, 0);
    const store = createInstalledMapStore(backing.storage, { budget: cost });
    await store.install(prepared.source.record.entryId, prepared.maps, prepared.source);
    await expect(
      installLocalMap(input('Bardzo dluga nowa nazwa'), { store, convert }),
    ).rejects.toBeInstanceOf(MapStorageFullError);
    expect((await store.readSource(prepared.source.record.entryId))?.record).toEqual(prepared.source.record);
    await expect(
      installLocalMap({ kind: 'archive', name: 'bad.zip', file: new Blob(['bad']) }, { store, convert }),
    ).rejects.toThrow();
    expect(await store.list()).toEqual(prepared.maps.map((map) => map.record));
    const [firstMap] = prepared.maps;
    if (firstMap === undefined) throw new Error('Missing converted fixture');
    const catalog = {
      ...firstMap.record,
      entryId: 'catalog',
      mapId: 'catalog',
      index: {
        ...firstMap.record.index,
        id: 'catalog',
        provenance: { kind: 'catalog' as const, folder: 'catalog' },
      },
    };
    await expect(
      store.install('catalog', [{ record: catalog, files: firstMap.files }]),
    ).rejects.toBeInstanceOf(MapStorageFullError);
  });
  it('keeps and serves decoded briefing pictures and spoken lines with the generated files', async () => {
    const files = bytes();
    files['mission.inc'] = new TextEncoder().encode('[MissionData]\nresult "PlayCutscene" 0 1\n');
    files['text/pol/briefings/briefings.txt'] = new TextEncoder().encode(
      '[blockstart:0]\nText\n[blockend:0]',
    );
    files['text/pol/briefings/0000.hlt'] = new TextEncoder().encode(
      '<onscreencallback:2000,1,0>\n<picture:$local$\\graphics\\map.pcx>',
    );
    files['sfx/pol/0001.wav'] = new TextEncoder().encode('RIFF\u0004\u0000\u0000\u0000WAVE');
    files['text/pol/briefings/graphics/map.pcx'] = encodePcx({
      width: 2,
      height: 1,
      pixels: new Uint8Array([1, 2]),
      palette: rampPalette(),
    });
    const backing = memoryInstalledStorage();
    const store = createInstalledMapStore(backing.storage, { budget: null });
    const prepared = await installLocalMap(
      { kind: 'archive', name: 'pictured.zip', file: new Blob([new Uint8Array(zipSync(files))]) },
      { store, convert },
    );
    const [map] = prepared.maps;
    if (map === undefined) throw new Error('Missing pictured map');
    const suffix = map.record.suffixes.find((suffix) => suffix.startsWith('.pictures-'));
    expect(suffix).toBeDefined();
    const response = await store.fetchFor(map.record)(`/maps/${map.record.mapId}${suffix}`);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await response.arrayBuffer()).slice(1, 4)).toEqual(new TextEncoder().encode('PNG'));
    const voice = await store.fetchFor(map.record)(`/maps/${map.record.mapId}.voice-pol-0001.wav`);
    expect(voice.headers.get('content-type')).toBe('audio/wav');
    expect(map.record.size).toBe([...map.files.values()].reduce((sum, data) => sum + data.byteLength, 0));
    await store.remove(map.record.entryId);
    expect(backing.files.size).toBe(0);
  });

  it('uses the retained source identity after decoder changes, including a renamed archive', async () => {
    const first = await prepareLocalImport(input(), { installedAt: 1 });
    const entryId = 'user-previous-decoder';
    const previous = {
      ...first.source.record,
      entryId,
      maps: first.source.record.maps.map((map, i) => ({ ...map, mapId: `${entryId}-${i + 1}` })),
    };
    const renamed = { ...input(), name: 'renamed.zip' };
    const result = await prepareLocalImport(renamed, { installedAt: 2, knownSources: [previous] });
    expect(result.source.record.entryId).toBe(entryId);
    expect(result.source.record.maps).toEqual(previous.maps);
    const again = await prepareLocalImport(result.source.input, {
      installedAt: 3,
      previous: result.source.record,
    });
    expect(again.source.record.maps).toEqual(previous.maps);
  });

  it('serializes budget decisions made by two stores sharing storage', async () => {
    const backing = memoryInstalledStorage();
    const prepared = await prepareLocalImport(input(), { installedAt: 1 });
    const [map] = prepared.maps;
    if (map === undefined) throw new Error('Missing fixture');
    const cost = prepared.source.record.size + map.record.size;
    const store = () => createInstalledMapStore(backing.storage, { budget: cost });
    const otherId = 'user-second';
    const otherMapId = `${otherId}-1`;
    const second = {
      record: {
        ...map.record,
        entryId: otherId,
        mapId: otherMapId,
        index: { ...map.record.index, id: otherMapId },
      },
      files: map.files,
    };
    const source = {
      ...prepared.source,
      record: { ...prepared.source.record, entryId: otherId, maps: [{ folder: 'map', mapId: otherMapId }] },
    };
    const results = await Promise.allSettled([
      store().install(prepared.source.record.entryId, prepared.maps, prepared.source),
      store().install(otherId, [second], source),
    ]);
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected']);
    expect(await store().sources()).toHaveLength(1);
  });
  it('routes a local map through stored files without announcing a catalogue reference', async () => {
    const backing = memoryInstalledStorage();
    const store = createInstalledMapStore(backing.storage, { budget: null });
    const prepared = await installLocalMap(input(), { store, convert });
    const registry = createMapSourceRegistry({
      store: () => store,
      shipped: async () => [],
      irVersion: IR_VERSION,
    });
    const [source] = await registry.sources();
    if (source === undefined) throw new Error('Missing local source');
    expect(source.catalog).toBeUndefined();
    expect(source.local?.entryId).toBe(prepared.source.record.entryId);
    const files = await registry.fetchFor(source.entry.id);
    expect(await (await files(`/maps/${source.entry.id}.json`)).json()).toMatchObject({
      width: 2,
      height: 1,
    });
    const shipped = { entry: { ...source.entry, id: 'shipped' }, stale: false, fetch };
    expect(subMissionPool([source, shipped], source.entry.id)).toEqual([source]);
    expect(subMissionPool([source, shipped], 'shipped')).toEqual([shipped]);
  });
  it.each(['remove', 'replace'])('does not overwrite a concurrent %s after reconversion', async (action) => {
    const backing = memoryInstalledStorage();
    const store = createInstalledMapStore(backing.storage, { budget: null });
    const first = await installLocalMap(input(), { store, convert });
    const started = deferred();
    const release = deferred();
    const rebuilding = reconvertLocalMap(first.source.record.entryId, {
      store,
      convert: async (request) => {
        started.resolve();
        await release.promise;
        return convert(request);
      },
    });
    await started.promise;
    const replacement =
      action === 'remove' ? null : await installLocalMap(input('Nowsza'), { store, convert });
    if (action === 'remove') await store.remove(first.source.record.entryId);
    release.resolve();
    await expect(rebuilding).rejects.toMatchObject({ name: 'LocalSourceChangedError' });
    expect((await store.readSource(first.source.record.entryId))?.record ?? null).toEqual(
      replacement?.source.record ?? null,
    );
  });

  it.each(['sources', 'readSource'] as const)(
    'cancels a pending %s read before starting conversion',
    async (method) => {
      const store = createInstalledMapStore(memoryInstalledStorage().storage, { budget: null });
      const first = await installLocalMap(input(), { store, convert });
      const before = await store.list();
      const started = deferred();
      vi.spyOn(store, method).mockImplementation(() => {
        started.resolve();
        return new Promise<never>(() => {});
      });
      const converter = vi.fn(convert);
      const controller = new AbortController();
      const options = { store, convert: converter, signal: controller.signal };
      const importing =
        method === 'sources'
          ? installLocalMap(input(), options)
          : reconvertLocalMap(first.source.record.entryId, options);
      const cancelled = expect(importing).rejects.toMatchObject({ name: 'AbortError' });
      await started.promise;
      controller.abort();
      await cancelled;
      expect(converter).not.toHaveBeenCalled();
      expect(await store.list()).toEqual(before);
    },
  );

  it('lists healthy maps beside stale maps without opening their retained input', async () => {
    const backing = memoryInstalledStorage();
    const store = createInstalledMapStore(backing.storage, { budget: null });
    const first = await installLocalMap(input(), { store, convert });
    for (const map of first.maps)
      backing.records.set(map.record.mapId, { ...map.record, irVersion: IR_VERSION - 1 });
    const record = first.maps[0]?.record;
    if (record === undefined) throw new Error('Missing fixture');
    backing.records.set('healthy-local', {
      ...record,
      mapId: 'healthy-local',
      entryId: 'healthy-local',
      index: { ...record.index, id: 'healthy-local' },
    });
    const readSource = vi.spyOn(store, 'readSource').mockImplementation(() => new Promise(() => {}));
    const registry = createMapSourceRegistry({
      store: () => store,
      shipped: async () => [
        { id: 'healthy', fingerprint: record.fingerprint, picture: false, minimap: false },
      ],
      irVersion: IR_VERSION,
    });
    const maps = await registry.sources();
    expect(maps.map((map) => [map.entry.id, map.stale])).toEqual([
      ['healthy', false],
      [first.maps[0]?.record.mapId, true],
      ['healthy-local', false],
    ]);
    expect(readSource).not.toHaveBeenCalled();
    expect((await registry.find('healthy'))?.stale).toBe(false);
    expect((await registry.find('healthy-local'))?.stale).toBe(false);
    readSource.mockRestore();
    await reconvertLocalMap(first.source.record.entryId, { store, convert });
    expect((await registry.find(first.maps[0]?.record.mapId ?? ''))?.stale).toBe(false);
  });
});
