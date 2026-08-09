/** Minimal IndexedDB plumbing shared by the pending-load hand-off and the save list store. */

export function openDb(name: string, upgrade: (db: IDBDatabase) => void): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => upgrade(request.result);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
  });
}

export function completed(txn: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    txn.oncomplete = () => resolve();
    txn.onerror = () => reject(txn.error ?? new Error('IndexedDB transaction failed'));
    txn.onabort = () => reject(txn.error ?? new Error('IndexedDB transaction aborted'));
  });
}
