import { completed, openDb } from '../../view/runtime/save-load/idb.js';
import type { ModelFile } from './model-files.js';

/**
 * The device cache of downloaded Bergamot model files: a gzip downloads once, is decoded and
 * verified against its pinned SHA-256, then lands in IndexedDB so the next game starts without the
 * download. The records hold the uncompressed bytes the engine loads from.
 */

const DB_NAME = 'open-northland-translate';
const FILES = 'files';

const fileKey = (file: ModelFile): string => `${file.sha256}-${file.name}`;

async function inDb<T>(mode: IDBTransactionMode, run: (txn: IDBTransaction) => T): Promise<T> {
  const db = await openDb(DB_NAME, (created) => {
    created.createObjectStore(FILES);
  });
  try {
    const txn = db.transaction(FILES, mode);
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

/** The hex SHA-256 of `bytes`, as the pinned snapshot names it. */
async function digest(bytes: ArrayBuffer): Promise<string> {
  const hex = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hex)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

const GZIP = 'gzip';

/** Decodes the gzip stream `download` answers, without holding the archive whole while it streams. */
async function decompressed(download: Promise<Response>): Promise<ArrayBuffer> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('this browser cannot decode gzip model files (no DecompressionStream)');
  }
  const response = await download;
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${response.url}`);
  return await new Response(response.body?.pipeThrough(new DecompressionStream(GZIP))).arrayBuffer();
}

/**
 * The verified uncompressed bytes of one pinned file, from the cache or a verified download. A file
 * whose content hashes to something else never lands in the cache and never reaches the engine.
 */
export async function fetchModelFile(file: ModelFile): Promise<ArrayBuffer> {
  const key = fileKey(file);
  const request = await inDb('readonly', (txn) => txn.objectStore(FILES).get(key));
  const cached = request.result as ArrayBuffer | undefined;
  if (cached !== undefined && cached.byteLength === file.bytes) return cached;
  const bytes = await decompressed(fetch(file.url, { credentials: 'omit' }));
  if (bytes.byteLength !== file.bytes) {
    throw new Error(`${file.name}: ${bytes.byteLength} bytes, expected ${file.bytes}`);
  }
  const sha256 = await digest(bytes);
  if (sha256 !== file.sha256) {
    throw new Error(`${file.name}: sha-256 ${sha256.slice(0, 16)}…, expected ${file.sha256.slice(0, 16)}…`);
  }
  await inDb('readwrite', (txn) => txn.objectStore(FILES).put(bytes, key));
  return bytes;
}
