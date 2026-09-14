import { isSaveBytes, type SaveBytes } from './codec.js';
import { completed, openDb } from './idb.js';

/**
 * The one-shot hand-off from a validated in-game load to the reloaded page's boot. IndexedDB rather
 * than sessionStorage: a real map's save runs to megabytes, and the storage quota rejection would
 * dead-end a legitimate file.
 */

const DB_NAME = 'open-northland-pending-load';
const STORE_NAME = 'files';
const ENTRY_KEY = 'next';

function openPendingDb(): Promise<IDBDatabase> {
  return openDb(DB_NAME, (db) => db.createObjectStore(STORE_NAME));
}

/** What the store holds between the hand-off and the boot: the save and whether the world resumes
 *  running at once, which a sub-mission transition asks for and a load from the menu does not. */
interface PendingSession {
  readonly bytes: SaveBytes;
  readonly resume: boolean;
}

/** Stage a validated save file's bytes for the page reload that follows. */
export async function storePendingLoad(bytes: SaveBytes, resume = false): Promise<void> {
  const db = await openPendingDb();
  try {
    const txn = db.transaction(STORE_NAME, 'readwrite');
    const session: PendingSession = { bytes, resume };
    txn.objectStore(STORE_NAME).put(session, ENTRY_KEY);
    await completed(txn);
  } finally {
    db.close();
  }
}

/** Drop staged bytes whose hand-off never reached an entry, so no later boot consumes them. */
export async function clearPendingLoad(): Promise<void> {
  const db = await openPendingDb();
  try {
    const txn = db.transaction(STORE_NAME, 'readwrite');
    txn.objectStore(STORE_NAME).delete(ENTRY_KEY);
    await completed(txn);
  } finally {
    db.close();
  }
}

/**
 * Read and delete the staged session in one transaction, so a boot that fails to restore it cannot
 * loop the failure; null on a normal fresh boot or over a record of another shape.
 */
export async function takePendingSession(): Promise<PendingSession | null> {
  const db = await openPendingDb();
  try {
    const txn = db.transaction(STORE_NAME, 'readwrite');
    const store = txn.objectStore(STORE_NAME);
    const read = store.get(ENTRY_KEY);
    store.delete(ENTRY_KEY);
    await completed(txn);
    const value: unknown = read.result;
    if (typeof value !== 'object' || value === null || !('bytes' in value) || !('resume' in value))
      return null;
    if (!isSaveBytes(value.bytes) || typeof value.resume !== 'boolean') return null;
    return { bytes: value.bytes, resume: value.resume };
  } finally {
    db.close();
  }
}
