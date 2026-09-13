import type { LobbyCompatibility } from '../compatibility.js';
import { MAX_CLIENT_VERSION_LENGTH } from '../limits.js';
import { asCount, asRecord } from '../untrusted.js';
import { parseLine } from './text.js';

const SHA256 = /^[a-f0-9]{64}$/;

export function fingerprint(value: unknown, at: string): string {
  if (typeof value !== 'string' || !SHA256.test(value))
    throw new Error(`${at}: expected a SHA-256 hex digest`);
  return value;
}

export function parseCompatibility(value: unknown, at: string): LobbyCompatibility | null {
  if (value === null) return null;
  const raw = asRecord(value, at);
  return {
    content: fingerprint(raw.content, `${at}.content`),
    map: raw.map === null ? null : fingerprint(raw.map, `${at}.map`),
    client: parseLine(raw.client, `${at}.client`, MAX_CLIENT_VERSION_LENGTH),
    protocol: asCount(raw.protocol, `${at}.protocol`),
    ...(raw.save === undefined
      ? {}
      : { save: raw.save === null ? null : fingerprint(raw.save, `${at}.save`) }),
  };
}
