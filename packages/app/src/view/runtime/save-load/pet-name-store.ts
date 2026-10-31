import { isAcceptedPetName, type PetNameArchive } from '../../../game/character-names/pet-names.js';
import { completed, openDb } from './idb.js';

/**
 * Where the player's renames of settlers outlive the page. It keeps its own database rather than a
 * third store of the saves': a rename belongs to the playthrough, not to the slot, so deleting one
 * save of a game must not take the names another save of it still shows, and the saves' layout stays
 * the save store's own to change.
 */

const DB_NAME = 'open-northland-pet-names';
const PET_NAMES_STORE = 'petnames';

function openPetNamesDb(): Promise<IDBDatabase> {
  return openDb(DB_NAME, (db) => {
    db.createObjectStore(PET_NAMES_STORE);
  });
}

async function inPetNamesDb<T>(mode: IDBTransactionMode, run: (txn: IDBTransaction) => T): Promise<T> {
  const db = await openPetNamesDb();
  try {
    const txn = db.transaction(PET_NAMES_STORE, mode);
    const result = run(txn);
    await completed(txn);
    return result;
  } finally {
    db.close();
  }
}

/** Entity ids as the object keys IndexedDB stores, since a record's keys are strings. */
function recordOf(names: ReadonlyMap<number, string>): Record<string, string> {
  return Object.fromEntries([...names].map(([entity, name]) => [String(entity), name]));
}

/** Tolerate a foreign or older record: an entry that is not an entity's accepted name is dropped. */
function storedPetNamesOf(value: unknown): Map<number, string> {
  const raw = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const names = new Map<number, string>();
  for (const [key, name] of Object.entries(raw)) {
    const entity = Number(key);
    if (Number.isSafeInteger(entity) && entity >= 0 && typeof name === 'string' && isAcceptedPetName(name)) {
      names.set(entity, name);
    }
  }
  return names;
}

export function browserPetNameArchive(): PetNameArchive {
  return {
    async read(key) {
      const found = await inPetNamesDb('readonly', (txn) => txn.objectStore(PET_NAMES_STORE).get(key));
      return storedPetNamesOf(found.result);
    },
    async write(key, names) {
      await inPetNamesDb('readwrite', (txn) => {
        txn.objectStore(PET_NAMES_STORE).put(recordOf(names), key);
      });
    },
  };
}
