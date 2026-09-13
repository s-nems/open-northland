import { DEFAULT_MAX_ROOMS } from '../relay/relay.js';
import { DEFAULT_MAX_CONNECTIONS } from './socket-budget.js';

export const DEFAULT_PORT = 8765;
const MAX_PORT = 65535;

export type Environment = Readonly<Record<string, string | undefined>>;

/** What a deployment sets; the address, the public URL and the build are reported as unknown when
 *  unset, the rest defaults. */
export interface RelayConfig {
  readonly port: number;
  /** The address to bind; null binds every interface. */
  readonly host: string | null;
  /** The `ws://` or `wss://` address clients reach this relay at, once a proxy stands in front. */
  readonly publicUrl: string | null;
  readonly maxRooms: number;
  readonly maxConnections: number;
  /** The build this image came from, for the health endpoint. */
  readonly build: string | null;
}

function setting(env: Environment, name: string): string | null {
  const raw = env[name];
  return raw === undefined || raw.trim() === '' ? null : raw.trim();
}

function integerSetting(env: Environment, name: string, fallback: number, min: number, max: number): number {
  const raw = setting(env, name);
  if (raw === null) return fallback;
  const value = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}, got ${raw}`);
  }
  return value;
}

function urlSetting(env: Environment, name: string): string | null {
  const raw = setting(env, name);
  if (raw === null) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${name} must be a ws:// or wss:// URL, got ${raw}`);
  }
  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
    throw new Error(`${name} must be a ws:// or wss:// URL, got ${raw}`);
  }
  return url.toString();
}

export function relayConfigFromEnvironment(env: Environment): RelayConfig {
  return {
    port: integerSetting(env, 'PORT', DEFAULT_PORT, 0, MAX_PORT),
    host: setting(env, 'HOST'),
    publicUrl: urlSetting(env, 'RELAY_PUBLIC_URL'),
    maxRooms: integerSetting(env, 'RELAY_MAX_ROOMS', DEFAULT_MAX_ROOMS, 1, Number.MAX_SAFE_INTEGER),
    maxConnections: integerSetting(env, 'RELAY_MAX_CONNECTIONS', DEFAULT_MAX_CONNECTIONS, 1, 65535),
    build: setting(env, 'RELAY_BUILD'),
  };
}
