import { isSaveBytes, type SaveBytes } from './codec.js';
import { completed, openDb } from './idb.js';
import { newestFirst, type SaveSlotInfo, type SaveSlotMeta, type SaveStore } from './store.js';

const DB_NAME = 'open-northland-saves';
/** Metadata sits apart from the payloads so a list never materializes megabytes of save bytes. */
const META_STORE = 'meta';
const BYTES_STORE = 'bytes';

function openSavesDb(): Promise<IDBDatabase> {
  return openDb(DB_NAME, (db) => {
    db.createObjectStore(META_STORE);
    db.createObjectStore(BYTES_STORE);
  });
}

async function inSavesDb<T>(
  stores: string | string[],
  mode: IDBTransactionMode,
  run: (txn: IDBTransaction) => T,
): Promise<T> {
  const db = await openSavesDb();
  try {
    const txn = db.transaction(stores, mode);
    const result = run(txn);
    await completed(txn);
    return result;
  } finally {
    db.close();
  }
}

export function browserSaveStore(): SaveStore {
  return {
    async list(): Promise<SaveSlotInfo[]> {
      const { keys, values } = await inSavesDb(META_STORE, 'readonly', (txn) => {
        const store = txn.objectStore(META_STORE);
        return { keys: store.getAllKeys(), values: store.getAll() };
      });
      const slots: SaveSlotInfo[] = [];
      keys.result.forEach((key, i) => {
        if (typeof key !== 'string') return;
        slots.push({ id: key, name: key, ...storedMetaOf(values.result[i]) });
      });
      return newestFirst(slots);
    },

    async read(id: string): Promise<SaveBytes | null> {
      const read = await inSavesDb(BYTES_STORE, 'readonly', (txn) => txn.objectStore(BYTES_STORE).get(id));
      return isSaveBytes(read.result) ? read.result : null;
    },

    async write(name: string, bytes: SaveBytes, meta: SaveSlotMeta): Promise<void> {
      await inSavesDb([META_STORE, BYTES_STORE], 'readwrite', (txn) => {
        txn.objectStore(META_STORE).put({ ...meta, savedAt: meta.savedAt ?? Date.now() }, name);
        txn.objectStore(BYTES_STORE).put(bytes, name);
      });
    },

    async remove(id: string): Promise<void> {
      await inSavesDb([META_STORE, BYTES_STORE], 'readwrite', (txn) => {
        txn.objectStore(META_STORE).delete(id);
        txn.objectStore(BYTES_STORE).delete(id);
      });
    },
  };
}

/** Tolerate a foreign or older record shape: every unverifiable field lists as null. */
function storedMetaOf(value: unknown): Omit<SaveSlotInfo, 'id' | 'name'> {
  const raw = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  return {
    mapId: typeof raw.mapId === 'string' ? raw.mapId : null,
    tick: typeof raw.tick === 'number' && Number.isInteger(raw.tick) && raw.tick >= 0 ? raw.tick : null,
    entry: typeof raw.entry === 'string' ? raw.entry : null,
    savedAt: typeof raw.savedAt === 'number' ? raw.savedAt : null,
  };
}
