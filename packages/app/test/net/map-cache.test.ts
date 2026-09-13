import type { RoomView } from '@open-northland/net-protocol';
import { expect, it, vi } from 'vitest';
import { createMapCache } from '../../src/content/transfer/cache.js';
import {
  type CachedMapMeta,
  cacheMeta,
  MAX_CACHED_MAP_BYTES,
  type MapCacheStorage,
  retainedCacheKeys,
} from '../../src/content/transfer/cache-store.js';
import { verifyMapDocuments } from '../../src/content/transfer/documents.js';
import { loadRoomMapDocuments } from '../../src/content/transfer/reload.js';

function storage() {
  const entries = new Map<string, { meta: CachedMapMeta; bytes: string }>();
  const store: MapCacheStorage = {
    list: async () => [...entries.values()].map((e) => structuredClone(e.meta)),
    read: async (key) => entries.get(key)?.bytes,
    write: async (meta, bytes) => {
      entries.set(meta.key, { meta, bytes });
    },
  };
  return { store, entries };
}
const handle = () => verifyMapDocuments('island', { width: 1, height: 1, typeIds: [0] }, null);
it('revalidates durable envelopes after recreating the cache and isolates fingerprints/origins', async () => {
  const { store, entries } = storage();
  const map = handle();
  await createMapCache(store, () => 1).write(map, 'user');
  const cache = createMapCache(store);
  expect(
    (await cache.read('island', { fingerprint: map.fingerprint, origin: 'user' }))?.handle.fingerprint,
  ).toBe(map.fingerprint);
  expect(await cache.read('island', { fingerprint: '0'.repeat(64), origin: 'user' })).toBeNull();
  expect(await cache.read('island', { fingerprint: map.fingerprint, origin: 'mod' })).toBeNull();
  const entry = [...entries.values()][0];
  if (entry === undefined) throw Error('missing fixture');
  entry.bytes = 'A'.repeat(entry.bytes.length);
  expect(await cache.read('island')).toBeNull();
  entry.meta = { ...entry.meta, origin: 'base' as 'user' };
  expect(await cache.read('island')).toBeNull();
});
it('selects newest validated version but skips corrupt metadata and never persists forbidden origins', async () => {
  const { store } = storage();
  const a = handle();
  const b = verifyMapDocuments('island', { width: 1, height: 1, typeIds: [1] }, null);
  await createMapCache(store, () => 1).write(a, 'user');
  await createMapCache(store, () => 2).write(b, 'user');
  expect((await createMapCache(store).read('island'))?.handle.fingerprint).toBe(b.fingerprint);
  await expect(createMapCache(store).write(a, 'base' as 'user')).rejects.toThrow();
  expect(cacheMeta({ mapId: '../escape' })).toBeNull();
});
it('evicts oldest entries by both count and total byte budget', () => {
  const meta = (i: number, size: number): CachedMapMeta => ({
    key: String(i),
    mapId: 'island',
    fingerprint: '0'.repeat(64),
    origin: 'user',
    storedAt: i,
    size,
  });
  expect([...retainedCacheKeys(Array.from({ length: 5 }, (_, i) => meta(i, 1)))]).toEqual([
    '4',
    '3',
    '2',
    '1',
  ]);
  expect([
    ...retainedCacheKeys([meta(1, MAX_CACHED_MAP_BYTES / 2), meta(2, MAX_CACHED_MAP_BYTES / 2), meta(3, 1)]),
  ]).toEqual(['3', '2']);
});
it('running reload requires the current room fingerprint and refuses a local protected-map claim', async () => {
  const map = handle();
  const cached = vi.fn(async () => ({ handle: map, origin: 'user' as const }));
  const room: RoomView = {
    id: 'r',
    state: 'running',
    creator: 'Host',
    settings: {
      name: 'r',
      world: { kind: 'map', mapId: 'island' },
      seed: 7,
      rules: { fog: null, progression: null, needs: null },
      speed: 1,
      mapOrigin: 'user',
    },
    seats: [],
    members: [
      {
        nick: 'Host',
        seat: 0,
        connected: true,
        compatibility: { map: map.fingerprint, content: 'c', client: 'b', protocol: 3 },
      },
    ],
  };
  expect(await loadRoomMapDocuments(room, { local: async () => null, cached, list: async () => [] })).toBe(
    map,
  );
  expect(cached).toHaveBeenCalledWith('island', { fingerprint: map.fingerprint, origin: 'user' });
  cached.mockClear();
  expect(
    await loadRoomMapDocuments(room, {
      local: async () => null,
      cached,
      list: async () => [{ id: 'ISLAND', minimap: false }],
    }),
  ).toBeNull();
  expect(cached).not.toHaveBeenCalled();
});
