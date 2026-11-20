import type { MapProvenance } from '@open-northland/data';
import { base64ToBytes, bytesToBase64, gzipText, inflateText } from '@open-northland/net-client';
import {
  MAX_MAP_DOCUMENT_BYTES,
  MAX_MAP_TRANSFER_BYTES,
  rawVerifiedMapDocuments,
  type VerifiedMapDocuments,
  verifyMapDocuments,
} from './documents.js';

export type DeliverableMapOrigin = 'mod' | 'user' | 'catalog';
const DELIVERABLE_ORIGINS: readonly DeliverableMapOrigin[] = ['mod', 'user', 'catalog'];

export function isDeliverableMapOrigin(kind: unknown): kind is DeliverableMapOrigin {
  return DELIVERABLE_ORIGINS.some((origin) => origin === kind);
}

/** Base-game and unknown maps never travel between players; the mod's, a player's own and catalogue
 *  maps may. */
export function mapDeliveryAllowed(provenance: Pick<MapProvenance, 'kind'> | null | undefined): boolean {
  return isDeliverableMapOrigin(provenance?.kind);
}

/** The envelope's JSON travels and is cached as its gzip, base64 encoded; the relay limit bounds the
 *  compressed bytes. */
const MAP_ENVELOPE_VERSION = 3;
/** The envelope's keys: the two fingerprinted documents and the map's text documents. */
const ENVELOPE_KEYS = ['version', 'mapId', 'map', 'script', 'strings', 'briefing', 'meta'];
/** The envelope's own keys and map id beside documents already bounded by the local limit. */
const ENVELOPE_OVERHEAD_BYTES = 1024;
const MAX_ENVELOPE_BYTES = MAX_MAP_DOCUMENT_BYTES + ENVELOPE_OVERHEAD_BYTES;
const BASE64_GROUP_BYTES = 3;
const BASE64_GROUP_CHARS = 4;
const MAX_BLOB_TEXT_LENGTH = Math.ceil(MAX_MAP_TRANSFER_BYTES / BASE64_GROUP_BYTES) * BASE64_GROUP_CHARS;
/** RFC 1952's two identification bytes, which open every gzip member. */
const GZIP_ID = [0x1f, 0x8b] as const;

export async function encodeMapTransfer(
  handle: VerifiedMapDocuments,
  provenance: Pick<MapProvenance, 'kind'>,
): Promise<string> {
  if (!mapDeliveryAllowed(provenance)) throw new Error('Map origin does not permit delivery');
  const documents = rawVerifiedMapDocuments(handle);
  const compressed = await gzipText(
    JSON.stringify({ version: MAP_ENVELOPE_VERSION, mapId: handle.mapId, ...documents }),
  );
  if (compressed.byteLength > MAX_MAP_TRANSFER_BYTES) throw new Error('Map envelope exceeds transfer limit');
  return bytesToBase64(compressed);
}

export async function decodeMapTransfer(
  bytes: string,
  expected: {
    readonly mapId: string;
    readonly fingerprint: string;
    readonly provenance: Pick<MapProvenance, 'kind'>;
  },
): Promise<VerifiedMapDocuments> {
  if (!mapDeliveryAllowed(expected.provenance)) throw new Error('Map origin does not permit delivery');
  if (
    bytes.length > MAX_BLOB_TEXT_LENGTH ||
    bytes.length % BASE64_GROUP_CHARS !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(bytes)
  ) {
    throw new Error('Invalid or oversized map blob');
  }
  const compressed = base64ToBytes(bytes);
  if (compressed.byteLength > MAX_MAP_TRANSFER_BYTES) throw new Error('Map blob exceeds transfer limit');
  if (compressed[0] !== GZIP_ID[0] || compressed[1] !== GZIP_ID[1]) throw new Error('Map blob is not gzip');
  const raw: unknown = JSON.parse(await inflateText(compressed, MAX_ENVELOPE_BYTES, 'map blob'));
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('Invalid map envelope');
  const record = raw as Record<string, unknown>;
  if (
    Object.keys(record).some((key) => !ENVELOPE_KEYS.includes(key)) ||
    ENVELOPE_KEYS.some((key) => !Object.hasOwn(record, key)) ||
    record.version !== MAP_ENVELOPE_VERSION ||
    record.mapId !== expected.mapId
  ) {
    throw new Error('Map envelope does not match room');
  }
  const { strings, briefing, meta } = record;
  const handle = verifyMapDocuments(expected.mapId, record.map, record.script, { strings, briefing, meta });
  if (handle.fingerprint !== expected.fingerprint) throw new Error('Map fingerprint does not match creator');
  return handle;
}
