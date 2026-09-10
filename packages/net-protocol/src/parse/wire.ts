import type { SyncDomain } from '@open-northland/sim';
import { MAX_BLOB_BYTES, MAX_COMMAND_KIND_LENGTH } from '../limits.js';
import type {
  BlobType,
  PlayerWireEnvelope,
  RelayWireEnvelope,
  WireCommand,
  WireDigest,
  WireEnvelope,
} from '../messages.js';
import { asArray, asCount, asInteger, asRecord, asString, keysOf, preview } from '../untrusted.js';
import { parseSeatIndex } from './room.js';

export const BLOB_TYPES = keysOf<BlobType>({ snapshot: true, save: true, map: true });

/** The sim's domains, repeated here so the relay never loads the sim; a test pins the copy. */
export const SYNC_DOMAINS = keysOf<SyncDomain>({
  rng: true,
  entities: true,
  players: true,
  movement: true,
  settlers: true,
  economy: true,
  combat: true,
  fog: true,
});

const WORD32_MAX = 0xffffffff;
const BASE64_SHAPE = /^[A-Za-z0-9+/]*={0,2}$/;
const BASE64_GROUP = 4;
const BYTES_PER_BASE64_GROUP = 3;
const MAX_BLOB_TEXT_LENGTH = Math.ceil(MAX_BLOB_BYTES / BYTES_PER_BASE64_GROUP) * BASE64_GROUP;

/** The wire's own reading of a seat envelope: the authority half only, since the command payload is the
 *  sim's contract and the relay never applies one. */
export function parseWireEnvelope(value: unknown, at: string): PlayerWireEnvelope {
  const raw = asRecord(value, at);
  if (raw.origin !== 'player') {
    throw new Error(`${at}: the wire carries player envelopes only, got origin ${preview(raw.origin)}`);
  }
  const command = asRecord(raw.command, `${at}.command`);
  asString(command.kind, `${at}.command.kind`, MAX_COMMAND_KIND_LENGTH);
  return {
    v: asCount(raw.v, `${at}.v`),
    origin: 'player',
    player: asInteger(raw.player, `${at}.player`),
    command: command as { readonly kind: string },
  };
}

/** An envelope inside a relay frame: a seat envelope, or the relay's one allowed trusted command. */
function parseFrameEnvelope(value: unknown, at: string): WireEnvelope {
  const raw = asRecord(value, at);
  if (raw.origin !== 'admin') return parseWireEnvelope(raw, at);
  const command = asRecord(raw.command, `${at}.command`);
  if (command.kind !== 'setPlayerAi') {
    throw new Error(`${at}: the relay may issue setPlayerAi only, got ${preview(command.kind)}`);
  }
  if (command.enabled !== true) throw new Error(`${at}.command.enabled: expected true`);
  const relayed: RelayWireEnvelope = {
    v: asCount(raw.v, `${at}.v`),
    origin: 'admin',
    command: {
      kind: 'setPlayerAi',
      player: parseSeatIndex(command.player, `${at}.command.player`),
      enabled: true,
    },
  };
  return relayed;
}

export function parseWireCommands(value: unknown, at: string): readonly WireCommand[] {
  return asArray(value, at).map((entry, i) => {
    const raw = asRecord(entry, `${at}[${i}]`);
    const sequence = asCount(raw.sequence, `${at}[${i}].sequence`);
    // The relay numbers a frame's commands 0..n-1 in order; anything else is not a relay frame.
    if (sequence !== i) throw new Error(`${at}[${i}]: sequence ${sequence} out of order`);
    return { envelope: parseFrameEnvelope(raw.envelope, `${at}[${i}].envelope`), sequence };
  });
}

/** Every domain, each an unsigned 32-bit word, and nothing else. */
export function parseDigest(value: unknown, at: string): WireDigest {
  const raw = asRecord(value, at);
  const digest: Partial<Record<SyncDomain, number>> = {};
  for (const domain of SYNC_DOMAINS) {
    const word = asCount(raw[domain], `${at}.${domain}`);
    if (word > WORD32_MAX) throw new Error(`${at}.${domain}: ${word} is not a 32-bit word`);
    digest[domain] = word;
  }
  const extra = Object.keys(raw).find((key) => !SYNC_DOMAINS.some((domain) => domain === key));
  if (extra !== undefined) throw new Error(`${at}: unknown domain ${preview(extra)}`);
  return digest as WireDigest;
}

/** Base64 text of at most `MAX_BLOB_BYTES` decoded; the relay never decodes it. */
export function parseBlobBytes(value: unknown, at: string): string {
  if (typeof value !== 'string') throw new Error(`${at}: expected base64 text`);
  // The length bound comes first: the shape check walks the whole text.
  if (value.length > MAX_BLOB_TEXT_LENGTH) throw new Error(`${at}: over ${MAX_BLOB_BYTES} bytes`);
  if (value.length === 0 || value.length % BASE64_GROUP !== 0 || !BASE64_SHAPE.test(value)) {
    throw new Error(`${at}: not base64`);
  }
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  const bytes = (value.length / BASE64_GROUP) * BYTES_PER_BASE64_GROUP - padding;
  if (bytes > MAX_BLOB_BYTES) throw new Error(`${at}: ${bytes} bytes over ${MAX_BLOB_BYTES}`);
  return value;
}
