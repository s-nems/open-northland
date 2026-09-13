import { completed, openDb } from '../../view/runtime/save-load/idb.js';
import { isMapId } from './documents.js';

export const MAX_CACHED_MAPS = 4;
export const MAX_CACHED_MAP_BYTES = 64 * 1024 * 1024;
export interface CachedMapMeta {
  readonly key: string;
  readonly mapId: string;
  readonly fingerprint: string;
  readonly origin: 'mod' | 'user';
  readonly storedAt: number;
  readonly size: number;
}
export interface MapCacheStorage {
  list(): Promise<unknown[]>;
  read(key: string): Promise<unknown>;
  write(meta: CachedMapMeta, bytes: string): Promise<void>;
}
export function cacheMeta(raw: unknown): CachedMapMeta | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (
    typeof r.mapId !== 'string' ||
    !isMapId(r.mapId) ||
    typeof r.fingerprint !== 'string' ||
    !/^[a-f0-9]{64}$/.test(r.fingerprint) ||
    (r.origin !== 'mod' && r.origin !== 'user') ||
    r.key !== `${r.mapId}:${r.fingerprint}:${r.origin}` ||
    typeof r.size !== 'number' ||
    !Number.isSafeInteger(r.size) ||
    r.size < 1 ||
    r.size > MAX_CACHED_MAP_BYTES ||
    typeof r.storedAt !== 'number' ||
    !Number.isSafeInteger(r.storedAt) ||
    r.storedAt < 0
  )
    return null;
  return {
    key: `${r.mapId}:${r.fingerprint}:${r.origin}`,
    mapId: r.mapId,
    fingerprint: r.fingerprint,
    origin: r.origin,
    storedAt: r.storedAt,
    size: r.size,
  };
}
export function retainedCacheKeys(entries: readonly CachedMapMeta[]): ReadonlySet<string> {
  const ordered = [...entries].sort(
    (a, b) => b.storedAt - a.storedAt || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
  );
  const keep = new Set<string>();
  let bytes = 0;
  for (const entry of ordered) {
    if (keep.size === MAX_CACHED_MAPS || bytes + entry.size > MAX_CACHED_MAP_BYTES) continue;
    keep.add(entry.key);
    bytes += entry.size;
  }
  return keep;
}
const META = 'meta';
const BYTES = 'bytes';
const open = () =>
  openDb('open-northland-verified-maps', (db) => {
    db.createObjectStore(META);
    db.createObjectStore(BYTES);
  });
export function browserMapCacheStorage(): MapCacheStorage {
  return {
    async list() {
      const db = await open();
      try {
        const txn = db.transaction(META, 'readonly');
        const req = txn.objectStore(META).getAll();
        await completed(txn);
        return req.result;
      } finally {
        db.close();
      }
    },
    async read(key) {
      const db = await open();
      try {
        const txn = db.transaction(BYTES, 'readonly');
        const req = txn.objectStore(BYTES).get(key);
        await completed(txn);
        return req.result;
      } finally {
        db.close();
      }
    },
    async write(meta, bytes) {
      const db = await open();
      try {
        const txn = db.transaction([META, BYTES], 'readwrite');
        const metadata = txn.objectStore(META);
        const payloads = txn.objectStore(BYTES);
        const keys = metadata.getAllKeys();
        const records = metadata.getAll();
        records.onsuccess = () => {
          const entries = records.result
            .map(cacheMeta)
            .filter((entry): entry is CachedMapMeta => entry !== null && entry.key !== meta.key);
          const keep = retainedCacheKeys([...entries, meta]);
          for (const key of keys.result)
            if (typeof key !== 'string' || !keep.has(key)) {
              metadata.delete(key);
              payloads.delete(key);
            }
          if (keep.has(meta.key)) {
            metadata.put(meta, meta.key);
            payloads.put(bytes, meta.key);
          }
        };
        await completed(txn);
      } finally {
        db.close();
      }
    },
  };
}
