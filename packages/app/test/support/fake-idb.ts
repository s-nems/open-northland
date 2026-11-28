/**
 * A minimal in-memory IndexedDB for the app suite: jsdom ships none, and the save list store, the
 * replay store and the pending-load hand-off need exactly open-with-upgrade, keyed get/put/delete,
 * whole-store getAll/getAllKeys, and transactions that complete after the requests they issued.
 * Data lives per database name across open/close, as a browser would keep it; `resetFakeIndexedDb`
 * clears everything between tests.
 */

type StoreData = Map<string, unknown>;
type DatabaseData = Map<string, StoreData>;

const databases = new Map<string, DatabaseData>();

/** Minimal surface the helpers read off a request: a result that appears once its event fires. */
class FakeRequest<T> {
  result: T;
  error: DOMException | null = null;
  onsuccess: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onupgradeneeded: ((event: unknown) => void) | null = null;

  constructor(result: T) {
    this.result = result;
    queueMicrotask(() => this.onsuccess?.(null));
  }
}

/** Completes two microtask hops out, so requests the caller issued in `run` fire first. */
class FakeTransaction {
  error: DOMException | null = null;
  oncomplete: (() => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onabort: ((event: unknown) => void) | null = null;

  constructor(
    private readonly stores: readonly string[],
    private readonly data: DatabaseData,
  ) {
    queueMicrotask(() => queueMicrotask(() => this.oncomplete?.()));
  }

  objectStore(name: string): FakeObjectStore {
    if (!this.stores.includes(name)) throw new Error(`no object store '${name}' in this transaction`);
    let store = this.data.get(name);
    if (store === undefined) {
      store = new Map();
      this.data.set(name, store);
    }
    return new FakeObjectStore(store);
  }
}

/** Writes land at once; reads answer what the store held when the request was made. */
class FakeObjectStore {
  constructor(private readonly data: StoreData) {}

  get(key: IDBValidKey): FakeRequest<unknown> {
    return new FakeRequest(this.data.get(String(key)));
  }

  getAllKeys(): FakeRequest<IDBValidKey[]> {
    return new FakeRequest([...this.data.keys()]);
  }

  getAll(): FakeRequest<unknown[]> {
    return new FakeRequest([...this.data.values()]);
  }

  put(value: unknown, key: IDBValidKey): FakeRequest<IDBValidKey> {
    this.data.set(String(key), value);
    return new FakeRequest(key);
  }

  delete(key: IDBValidKey): FakeRequest<undefined> {
    this.data.delete(String(key));
    return new FakeRequest(undefined);
  }
}

/** Stores are created only on the first open of their database, as one version bump would. */
class FakeDatabase {
  constructor(private readonly data: DatabaseData) {}

  createObjectStore(name: string): void {
    this.data.set(name, new Map());
  }

  transaction(stores: string | readonly string[]): FakeTransaction {
    return new FakeTransaction(typeof stores === 'string' ? [stores] : stores, this.data);
  }

  close(): void {}
}

/** The database this open finds, so tests can corrupt one record behind a store's back. */
export function fakeIdbDatabase(name: string): DatabaseData | undefined {
  return databases.get(name);
}

export function resetFakeIndexedDb(): void {
  databases.clear();
}

export function installFakeIndexedDb(): void {
  (globalThis as { indexedDB?: unknown }).indexedDB = {
    open(name: string): FakeRequest<IDBDatabase> {
      const data = databases.get(name) ?? new Map<string, StoreData>();
      const fresh = !databases.has(name);
      databases.set(name, data);
      const request = new FakeRequest<IDBDatabase>(new FakeDatabase(data) as unknown as IDBDatabase);
      // Replace the immediate success with the upgrade-then-success order a version bump follows.
      request.onsuccess = null;
      queueMicrotask(() => {
        if (fresh) request.onupgradeneeded?.(null);
        queueMicrotask(() => request.onsuccess?.(null));
      });
      return request;
    },
  };
}
