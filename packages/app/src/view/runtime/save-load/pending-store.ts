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

/** Stage a validated save file's bytes for the page reload that follows. */
export async function storePendingLoad(bytes: SaveBytes): Promise<void> {
  const db = await openPendingDb();
  try {
    const txn = db.transaction(STORE_NAME, 'readwrite');
    txn.objectStore(STORE_NAME).put(bytes, ENTRY_KEY);
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
 * Read and delete the staged bytes in one transaction, so a boot that fails to restore them cannot
 * loop the failure; null on a normal fresh boot.
 */
export async function takePendingLoad(): Promise<SaveBytes | null> {
  const db = await openPendingDb();
  try {
    const txn = db.transaction(STORE_NAME, 'readwrite');
    const store = txn.objectStore(STORE_NAME);
    const read = store.get(ENTRY_KEY);
    store.delete(ENTRY_KEY);
    await completed(txn);
    return isSaveBytes(read.result) ? read.result : null;
  } finally {
    db.close();
  }
}
