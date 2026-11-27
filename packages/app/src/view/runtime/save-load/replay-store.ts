import { isSaveBytes, type SaveBytes } from './codec.js';
import { completed, openDb } from './idb.js';

/** The replay list: named recordings of played sessions, newest first, overwritten by name. */

const DB_NAME = 'open-northland-replays';
/** Metadata sits apart from the payloads so a list never materializes megabytes of recording bytes. */
const META_STORE = 'meta';
const BYTES_STORE = 'bytes';

/** One listed replay: the store identity plus the metadata the list UI shows. */
export interface ReplaySlotInfo {
  /** Store key; the browser store keys a slot by the name the capture composed. */
  readonly id: string;
  readonly name: string;
  readonly mapId: string;
  /** The last tick the recording covers, which lists as the match time it spans. */
  readonly untilTick: number;
  readonly seed: number;
  /** Milliseconds since the epoch, taken at the capture. */
  readonly savedAt: number;
}

/** The replay header's provenance, recorded beside the bytes so a list never inflates a recording. */
export interface ReplaySlotMeta {
  readonly mapId: string;
  readonly untilTick: number;
  readonly seed: number;
  readonly savedAt: number;
}

/** The replay store: named slots, newest first, overwritten by name. */
export interface ReplayStore {
  list(): Promise<ReplaySlotInfo[]>;
  read(id: string): Promise<SaveBytes | null>;
  write(name: string, bytes: SaveBytes, meta: ReplaySlotMeta): Promise<void>;
  remove(id: string): Promise<void>;
}

function openReplaysDb(): Promise<IDBDatabase> {
  return openDb(DB_NAME, (db) => {
    db.createObjectStore(META_STORE);
    db.createObjectStore(BYTES_STORE);
  });
}

async function inReplaysDb<T>(
  stores: string | string[],
  mode: IDBTransactionMode,
  run: (txn: IDBTransaction) => T,
): Promise<T> {
  const db = await openReplaysDb();
  try {
    const txn = db.transaction(stores, mode);
    const result = run(txn);
    await completed(txn);
    return result;
  } finally {
    db.close();
  }
}

export function browserReplayStore(): ReplayStore {
  return {
    async list(): Promise<ReplaySlotInfo[]> {
      const { keys, values } = await inReplaysDb(META_STORE, 'readonly', (txn) => {
        const store = txn.objectStore(META_STORE);
        return { keys: store.getAllKeys(), values: store.getAll() };
      });
      const slots: ReplaySlotInfo[] = [];
      keys.result.forEach((key, i) => {
        if (typeof key !== 'string') return;
        const meta = storedMetaOf(values.result[i]);
        if (meta === null) return;
        slots.push({ id: key, name: key, ...meta });
      });
      return slots.sort((a, b) => b.savedAt - a.savedAt);
    },

    async read(id: string): Promise<SaveBytes | null> {
      const read = await inReplaysDb(BYTES_STORE, 'readonly', (txn) => txn.objectStore(BYTES_STORE).get(id));
      return isSaveBytes(read.result) ? read.result : null;
    },

    async write(name: string, bytes: SaveBytes, meta: ReplaySlotMeta): Promise<void> {
      await inReplaysDb([META_STORE, BYTES_STORE], 'readwrite', (txn) => {
        txn.objectStore(META_STORE).put(meta, name);
        txn.objectStore(BYTES_STORE).put(bytes, name);
      });
    },

    async remove(id: string): Promise<void> {
      await inReplaysDb([META_STORE, BYTES_STORE], 'readwrite', (txn) => {
        txn.objectStore(META_STORE).delete(id);
        txn.objectStore(BYTES_STORE).delete(id);
      });
    },
  };
}

/** Tolerate a foreign or older record shape: an unverifiable slot lists as nothing rather than lying. */
function storedMetaOf(value: unknown): Omit<ReplaySlotInfo, 'id' | 'name'> | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (
    typeof raw.mapId !== 'string' ||
    typeof raw.untilTick !== 'number' ||
    !Number.isSafeInteger(raw.untilTick) ||
    raw.untilTick < 0 ||
    typeof raw.seed !== 'number' ||
    !Number.isSafeInteger(raw.seed) ||
    typeof raw.savedAt !== 'number' ||
    !Number.isSafeInteger(raw.savedAt)
  ) {
    return null;
  }
  return { mapId: raw.mapId, untilTick: raw.untilTick, seed: raw.seed, savedAt: raw.savedAt };
}
