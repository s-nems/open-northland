import { jsonFingerprint, MapScript, parseTerrainMap } from '@open-northland/data';
import { MAX_BLOB_BYTES } from '@open-northland/net-protocol';

export const MAX_MAP_TRANSFER_BYTES = MAX_BLOB_BYTES;
// The owned six-sons map exceeds the relay limit but can still be verified and played locally.
export const MAX_MAP_DOCUMENT_BYTES = 64 * 1024 * 1024;
export interface VerifiedMapDocuments {
  readonly mapId: string;
  readonly fingerprint: string;
}
interface Documents {
  readonly map: unknown;
  readonly script: unknown;
}
const retained = new WeakMap<VerifiedMapDocuments, Documents>();

/** A map id names a file on every peer, so it is one plain ASCII token. */
export function isMapId(mapId: string): boolean {
  return /^[a-z0-9_-]{1,128}$/i.test(mapId);
}

export function validMapId(mapId: string): void {
  if (!isMapId(mapId)) throw new Error('Invalid lobby map id');
}

/** Own the exact raw documents whose fingerprint was verified, including unknown script fields. */
export function verifyMapDocuments(mapId: string, map: unknown, script: unknown): VerifiedMapDocuments {
  validMapId(mapId);
  const text = JSON.stringify({ map, script });
  if (
    text.length > MAX_MAP_DOCUMENT_BYTES ||
    new TextEncoder().encode(text).byteLength > MAX_MAP_DOCUMENT_BYTES
  ) {
    throw new Error('Map documents exceed local size limit');
  }
  const owned: Documents = JSON.parse(text);
  parseTerrainMap(owned.map);
  if (owned.script !== null) MapScript.parse(owned.script);
  const handle = Object.freeze({ mapId, fingerprint: jsonFingerprint(owned) });
  retained.set(handle, owned);
  return handle;
}

export function rawVerifiedMapDocuments(handle: VerifiedMapDocuments): Documents {
  const value = retained.get(handle);
  if (value === undefined) throw new Error('Unverified map documents');
  return structuredClone(value);
}

export function readVerifiedMapDocuments(handle: VerifiedMapDocuments, mapId: string = handle.mapId) {
  if (handle.mapId !== mapId) throw new Error('Verified map does not match boot map');
  const value = retained.get(handle);
  if (value === undefined) throw new Error('Unverified map documents');
  return {
    map: parseTerrainMap(value.map),
    script: value.script === null ? null : MapScript.parse(value.script),
  };
}

async function readDocument(path: string, fetchImpl: typeof fetch): Promise<unknown> {
  const response = await fetchImpl(path);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Cannot read ${path}: HTTP ${response.status}`);
  const length = Number(response.headers.get('content-length'));
  if (length > MAX_MAP_DOCUMENT_BYTES) throw new Error('Map document exceeds local size limit');
  if (response.body === null) throw new Error('Empty map document');
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let total = 0;
  let text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_MAP_DOCUMENT_BYTES) throw new Error('Map document exceeds local size limit');
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

export async function loadVerifiedMapDocuments(
  mapId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<VerifiedMapDocuments | null> {
  validMapId(mapId);
  const [map, script] = await Promise.all([
    readDocument(`/maps/${mapId}.json`, fetchImpl),
    readDocument(`/maps/${mapId}.script.json`, fetchImpl),
  ]);
  return map === null ? null : verifyMapDocuments(mapId, map, script);
}
