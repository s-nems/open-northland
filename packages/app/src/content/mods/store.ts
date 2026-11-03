import { completed, openDb } from '../../view/runtime/save-load/idb.js';
import type { ContentModFiles } from './archive.js';

const DB_NAME = 'open-northland-content-mods-v2';
const PACKS = 'packs';
const FILES = 'files';
const RECORD_VERSION = 1;
const MAX_INSTALLED_MOD_BYTES = 512 * 1024 * 1024;

export interface ContentModRecord {
  readonly version: typeof RECORD_VERSION;
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly size: number;
  readonly unpackedSize: number;
}

export interface ContentModSummary {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly size: number;
}

export interface ContentModFile {
  readonly id: string;
  readonly bytes: Uint8Array;
}

let activeModsPromise: Promise<ContentModRecord[]> | null = null;

function storedMod(raw: unknown): ContentModRecord | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Record<string, unknown>;
  if (
    record.version !== RECORD_VERSION ||
    typeof record.id !== 'string' ||
    !/^[0-9a-f]{64}$/.test(record.id) ||
    typeof record.name !== 'string' ||
    typeof record.enabled !== 'boolean' ||
    typeof record.size !== 'number' ||
    typeof record.unpackedSize !== 'number'
  )
    return null;
  return {
    version: RECORD_VERSION,
    id: record.id,
    name: record.name,
    enabled: record.enabled,
    size: record.size,
    unpackedSize: record.unpackedSize,
  };
}

async function inDb<T>(
  stores: string | string[],
  mode: IDBTransactionMode,
  run: (txn: IDBTransaction) => T,
): Promise<T> {
  const db = await openDb(DB_NAME, (created) => {
    if (!created.objectStoreNames.contains(PACKS)) created.createObjectStore(PACKS);
    if (!created.objectStoreNames.contains(FILES)) created.createObjectStore(FILES);
  });
  try {
    const txn = db.transaction(stores, mode);
    const done = completed(txn);
    try {
      const result = run(txn);
      await done;
      return result;
    } catch (error) {
      try {
        txn.abort();
      } catch {
        /* The transaction may already have aborted. */
      }
      await done.catch(() => undefined);
      throw error;
    }
  } finally {
    db.close();
  }
}

async function records(): Promise<ContentModRecord[]> {
  if (typeof indexedDB === 'undefined') return [];
  const request = await inDb(PACKS, 'readonly', (txn) => txn.objectStore(PACKS).getAll());
  return request.result.map(storedMod).filter((record) => record !== null);
}

function summaries(items: readonly ContentModRecord[]): ContentModSummary[] {
  return items
    .map(({ id, name, enabled, size }) => ({ id, name, enabled, size }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export async function listContentMods(): Promise<readonly ContentModSummary[]> {
  return summaries(await records());
}

export async function installContentMod(mod: ContentModFiles): Promise<void> {
  const installed = await records();
  const used = installed
    .filter((record) => record.id !== mod.id)
    .reduce((total, record) => total + record.unpackedSize, 0);
  const incoming = mod.files.reduce((total, file) => total + file.bytes.byteLength, 0);
  if (used + incoming > MAX_INSTALLED_MOD_BYTES)
    throw new Error('Installed content packs exceed the 512 MiB storage limit');
  await inDb([PACKS, FILES], 'readwrite', (txn) => {
    const fileStore = txn.objectStore(FILES);
    const prefix = `${mod.id}:`;
    fileStore.delete(IDBKeyRange.bound(prefix, `${prefix}\uffff`));
    for (const file of mod.files) fileStore.put(file.bytes, `${prefix}${file.path}`);
    txn.objectStore(PACKS).put(
      {
        version: RECORD_VERSION,
        id: mod.id,
        name: mod.name,
        enabled: true,
        size: mod.size,
        unpackedSize: incoming,
      } satisfies ContentModRecord,
      mod.id,
    );
  });
  activeModsPromise = null;
}

export async function setContentModEnabled(id: string, enabled: boolean): Promise<void> {
  const item = (await records()).find((record) => record.id === id);
  if (item === undefined) return;
  await inDb(PACKS, 'readwrite', (txn) => txn.objectStore(PACKS).put({ ...item, enabled }, id));
  activeModsPromise = null;
}

export async function removeContentMod(id: string): Promise<void> {
  const prefix = `${id}:`;
  await inDb([PACKS, FILES], 'readwrite', (txn) => {
    txn.objectStore(PACKS).delete(id);
    txn.objectStore(FILES).delete(IDBKeyRange.bound(prefix, `${prefix}\uffff`));
  });
  activeModsPromise = null;
}

async function activeMods(): Promise<ContentModRecord[]> {
  activeModsPromise ??= records().then((items) =>
    items.filter((record) => record.enabled).sort((a, b) => a.id.localeCompare(b.id)),
  );
  return activeModsPromise;
}

export async function activeContentModIds(): Promise<readonly string[]> {
  return (await activeMods()).map((record) => record.id);
}

export function contentModFiles(path: string): Promise<readonly ContentModFile[]> {
  const normalized = path.replace(/^\/+/, '').toLowerCase();
  return activeMods().then(async (mods): Promise<readonly ContentModFile[]> => {
    if (mods.length === 0 || typeof indexedDB === 'undefined') return [];
    const requests = await inDb(FILES, 'readonly', (txn) =>
      mods.map((mod) => txn.objectStore(FILES).get(`${mod.id}:${normalized}`)),
    );
    return mods.flatMap((mod, index) => {
      const value: unknown = requests[index]?.result;
      if (value instanceof Uint8Array) return [{ id: mod.id, bytes: value }];
      if (value instanceof ArrayBuffer) return [{ id: mod.id, bytes: new Uint8Array(value) }];
      return [];
    });
  });
}

export async function contentModFile(path: string): Promise<Uint8Array | null> {
  const files = await contentModFiles(path);
  return files.at(-1)?.bytes ?? null;
}
