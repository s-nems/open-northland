import type { MapProvenance } from '@open-northland/data';
import { base64ToBytes, bytesToBase64 } from '@open-northland/net-client';
import {
  MAX_MAP_TRANSFER_BYTES,
  rawVerifiedMapDocuments,
  type VerifiedMapDocuments,
  verifyMapDocuments,
} from './documents.js';

export type DeliverableMapOrigin = 'mod' | 'user';
export function mapDeliveryAllowed(provenance: Pick<MapProvenance, 'kind'> | null | undefined): boolean {
  return provenance?.kind === 'mod' || provenance?.kind === 'user';
}

export function encodeMapTransfer(
  handle: VerifiedMapDocuments,
  provenance: Pick<MapProvenance, 'kind'>,
): string {
  if (!mapDeliveryAllowed(provenance)) throw new Error('Map origin does not permit delivery');
  const documents = rawVerifiedMapDocuments(handle);
  const bytes = new TextEncoder().encode(JSON.stringify({ version: 1, mapId: handle.mapId, ...documents }));
  if (bytes.byteLength > MAX_MAP_TRANSFER_BYTES) throw new Error('Map envelope exceeds transfer limit');
  return bytesToBase64(bytes);
}

export function decodeMapTransfer(
  bytes: string,
  expected: {
    readonly mapId: string;
    readonly fingerprint: string;
    readonly provenance: Pick<MapProvenance, 'kind'>;
  },
): VerifiedMapDocuments {
  if (!mapDeliveryAllowed(expected.provenance)) throw new Error('Map origin does not permit delivery');
  if (
    bytes.length > Math.ceil(MAX_MAP_TRANSFER_BYTES / 3) * 4 ||
    bytes.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(bytes)
  ) {
    throw new Error('Invalid or oversized map blob');
  }
  const decoded = base64ToBytes(bytes);
  if (decoded.byteLength > MAX_MAP_TRANSFER_BYTES) throw new Error('Map blob exceeds transfer limit');
  const raw: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(decoded));
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('Invalid map envelope');
  const record = raw as Record<string, unknown>;
  if (
    Object.keys(record).some((key) => !['version', 'mapId', 'map', 'script'].includes(key)) ||
    record.version !== 1 ||
    record.mapId !== expected.mapId ||
    !Object.hasOwn(record, 'script')
  ) {
    throw new Error('Map envelope does not match room');
  }
  const handle = verifyMapDocuments(expected.mapId, record.map, record.script);
  if (handle.fingerprint !== expected.fingerprint) throw new Error('Map fingerprint does not match creator');
  return handle;
}
