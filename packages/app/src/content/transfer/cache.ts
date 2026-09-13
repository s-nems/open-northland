import { diag } from '../../diag/index.js';
import {
  browserMapCacheStorage,
  type CachedMapMeta,
  cacheMeta,
  type MapCacheStorage,
} from './cache-store.js';
import { type DeliverableMapOrigin, decodeMapTransfer, encodeMapTransfer } from './codec.js';
import type { VerifiedMapDocuments } from './documents.js';

const origins = new WeakMap<VerifiedMapDocuments, DeliverableMapOrigin>();
export function persistedMapOrigin(handle: VerifiedMapDocuments): DeliverableMapOrigin | undefined {
  return origins.get(handle);
}

export interface PersistedMap {
  readonly handle: VerifiedMapDocuments;
  readonly origin: DeliverableMapOrigin;
}
/** What a cached copy must match; without a fingerprint the newest copy of that origin is read. */
export interface PersistedMapExpected {
  readonly fingerprint?: string;
  readonly origin: DeliverableMapOrigin;
}
export function createMapCache(storage: MapCacheStorage, now: () => number = Date.now) {
  return {
    async read(mapId: string, expected?: PersistedMapExpected): Promise<PersistedMap | null> {
      const entries = (await storage.list())
        .map(cacheMeta)
        .filter(
          (entry): entry is CachedMapMeta =>
            entry !== null &&
            entry.mapId === mapId &&
            (expected === undefined ||
              ((expected.fingerprint === undefined || entry.fingerprint === expected.fingerprint) &&
                entry.origin === expected.origin)),
        )
        .sort((a, b) => b.storedAt - a.storedAt);
      for (const entry of entries) {
        const bytes = await storage.read(entry.key);
        if (typeof bytes !== 'string' || bytes.length !== entry.size) continue;
        try {
          const handle = decodeMapTransfer(bytes, {
            mapId,
            fingerprint: entry.fingerprint,
            provenance: { kind: entry.origin },
          });
          origins.set(handle, entry.origin);
          return { handle, origin: entry.origin };
        } catch {
          /* Cache corruption never becomes boot input. */
        }
      }
      return null;
    },
    async write(handle: VerifiedMapDocuments, origin: DeliverableMapOrigin): Promise<void> {
      const bytes = encodeMapTransfer(handle, { kind: origin });
      await storage.write(
        {
          key: `${handle.mapId}:${handle.fingerprint}:${origin}`,
          mapId: handle.mapId,
          fingerprint: handle.fingerprint,
          origin,
          storedAt: now(),
          size: bytes.length,
        },
        bytes,
      );
    },
  };
}
const browserCache = createMapCache(browserMapCacheStorage());
export async function loadPersistedMap(
  mapId: string,
  expected?: PersistedMapExpected,
): Promise<PersistedMap | null> {
  try {
    return await browserCache.read(mapId, expected);
  } catch (error) {
    diag.warn('content', 'Map cache unavailable', { error: String(error) });
    return null;
  }
}
export async function persistVerifiedMap(
  handle: VerifiedMapDocuments,
  origin: DeliverableMapOrigin,
): Promise<void> {
  try {
    await browserCache.write(handle, origin);
  } catch (error) {
    diag.warn('content', 'Map cache could not retain downloaded map', { error: String(error) });
  }
}
