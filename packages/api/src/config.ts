import { resolve } from 'node:path';
import { REPORT_UPLOAD_LIMITS } from '@open-northland/data';

export const DEFAULT_PORT = 8790;
const MAX_PORT = 65535;
export const DEFAULT_UPSTREAM = 'https://api.culturesnation.pl';
/** The community map database at wikinger-tommy.de, the catalogue's second source. */
export const DEFAULT_MAPDB_UPSTREAM = 'https://www.wikinger-tommy.de';
/** Relative to the directory the server starts in, which `npm run api` makes the checkout root. */
export const DEFAULT_DATA_DIR = '.api-data';
/** A separate volume from the data dir, so a deploy's data snapshot never copies player reports. */
export const DEFAULT_REPORTS_DIR = '.api-reports';
/** The web game and the desktop shell's page; a loopback http origin is always allowed besides. */
export const DEFAULT_REPORT_ORIGINS = ['https://game.opennorthland.org', 'app://game'] as const;

const SECONDS_PER_UNIT = { s: 1, m: 60, h: 3600, d: 86_400 } as const;
type IntervalUnit = keyof typeof SECONDS_PER_UNIT;
const DEFAULT_SYNC_INTERVAL_SECONDS = 6 * SECONDS_PER_UNIT.h;
/** Shorter intervals would only load the upstream: its catalogue changes a few times a week. */
const MIN_SYNC_INTERVAL_SECONDS = SECONDS_PER_UNIT.m;
/** Below the 2^31 ms a Node timer accepts. */
const MAX_SYNC_INTERVAL_SECONDS = 7 * SECONDS_PER_UNIT.d;
const MS_PER_SECOND = 1000;
const DEFAULT_CONVERT_CONCURRENCY = 1;
/** Concurrent archive downloads and isolated conversion workers. */
const MAX_CONVERT_CONCURRENCY = 8;
const DEFAULT_CONVERT_TIMEOUT_SECONDS = 120;
const MAX_CONVERT_TIMEOUT_SECONDS = 600;
const KIB = 1024;
const MIB = KIB * KIB;
const GIB = KIB * MIB;
/** Bounds of the report limits a deployment may set: wide enough to tune, never unbounded. */
const MAX_REPORT_BODY_BYTES = 64 * MIB;
/** Twice the default addendum: the shape check's value budget grows with the inflated cap, and an
 *  upload whose decode outgrows the decode process's heap is refused as too complex. */
const MAX_REPORT_INFLATED_BYTES = 32 * MIB;
const MAX_REPORT_RATE = 100_000;
const MAX_REPORT_STORE_BYTES = 1024 * GIB;
const MAX_REPORT_STORE_COUNT = 10_000_000;
const ORIGIN = /^[a-z][a-z0-9+.-]*:\/\/[^/\s?#]+$/;

/** Report limits and their defaults: setting name, default, and the largest value accepted. */
const REPORT_LIMIT_SETTINGS = {
  maxReportBytes: ['API_REPORT_MAX_BYTES', REPORT_UPLOAD_LIMITS.report.bytes, MAX_REPORT_BODY_BYTES],
  maxAddendumBytes: [
    'API_REPORT_ADDENDUM_MAX_BYTES',
    REPORT_UPLOAD_LIMITS.addendum.bytes,
    MAX_REPORT_BODY_BYTES,
  ],
  maxReportInflatedBytes: [
    'API_REPORT_MAX_INFLATED_BYTES',
    REPORT_UPLOAD_LIMITS.report.inflatedBytes,
    MAX_REPORT_INFLATED_BYTES,
  ],
  maxAddendumInflatedBytes: [
    'API_REPORT_ADDENDUM_MAX_INFLATED_BYTES',
    REPORT_UPLOAD_LIMITS.addendum.inflatedBytes,
    MAX_REPORT_INFLATED_BYTES,
  ],
  ipReportsPerHour: ['API_REPORT_IP_HOURLY', 6, MAX_REPORT_RATE],
  ipReportsPerDay: ['API_REPORT_IP_DAILY', 20, MAX_REPORT_RATE],
  ipAddendaPerHour: ['API_REPORT_IP_ADDENDA_HOURLY', 6, MAX_REPORT_RATE],
  uploadsPerHour: ['API_REPORT_GLOBAL_HOURLY', 200, MAX_REPORT_RATE],
  /** Bytes of every upload in an hour: its compressed body, or the files it decoded to when larger. */
  uploadBytesPerHour: ['API_REPORT_GLOBAL_HOURLY_BYTES', 256 * MIB, MAX_REPORT_STORE_BYTES],
  /** One client's share of those bytes, so a few clients cannot spend the hour's budget for everyone. */
  ipUploadBytesPerHour: ['API_REPORT_IP_HOURLY_BYTES', 16 * MIB, MAX_REPORT_STORE_BYTES],
  fingerprintPerDay: ['API_REPORT_FINGERPRINT_DAILY', 10, MAX_REPORT_RATE],
  maxStoredBytes: ['API_REPORT_MAX_STORED_BYTES', 2 * GIB, MAX_REPORT_STORE_BYTES],
  maxStoredReports: ['API_REPORT_MAX_STORED', 20_000, MAX_REPORT_STORE_COUNT],
} as const satisfies Record<string, readonly [string, number, number]>;

export type ReportLimits = { readonly [K in keyof typeof REPORT_LIMIT_SETTINGS]: number };

export interface ReportsConfig {
  /** Absolute path of the directory the report store writes. */
  readonly dir: string;
  /** Key the limiter on `X-Forwarded-For` instead of the socket address: set only behind a proxy
   *  that overwrites it. */
  readonly trustForwardedFor: boolean;
  /** Exact origins a browser may post a report from, lowercase. */
  readonly origins: readonly string[];
  readonly limits: ReportLimits;
}

export type Environment = Readonly<Record<string, string | undefined>>;

/** What a deployment sets; the address and the build are reported as unknown when unset, the rest
 *  defaults. */
export interface ApiConfig {
  readonly port: number;
  /** The address to bind; null binds every interface. */
  readonly host: string | null;
  /** Absolute path of the directory holding the catalogue, the raw pages and the thumbnails. */
  readonly dataDir: string;
  /** Origin of the culturesnation.pl Strapi API, without a trailing slash. */
  readonly upstream: string;
  /** Origin of the wikinger-tommy.de mapdb, without a trailing slash, or null when a deployment
   *  serves the other source alone. */
  readonly mapdbUpstream: string | null;
  readonly syncIntervalMs: number;
  /** Catalogue files downloaded and converted at once. */
  readonly convertConcurrency: number;
  /** Wall-clock budget of one conversion worker, including startup. */
  readonly convertTimeoutMs: number;
  /** The build this image came from, for the health endpoint. */
  readonly build: string | null;
  readonly reports: ReportsConfig;
}

function setting(env: Environment, name: string): string | null {
  const raw = env[name];
  return raw === undefined || raw.trim() === '' ? null : raw.trim();
}

function portSetting(env: Environment): number {
  const raw = setting(env, 'PORT');
  if (raw === null) return DEFAULT_PORT;
  const value = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isInteger(value) || value > MAX_PORT) {
    throw new Error(`PORT must be an integer from 0 to ${MAX_PORT}, got ${raw}`);
  }
  return value;
}

function upstreamSetting(env: Environment): string {
  const raw = setting(env, 'ON_API_UPSTREAM') ?? DEFAULT_UPSTREAM;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`ON_API_UPSTREAM must be an http:// or https:// URL, got ${raw}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`ON_API_UPSTREAM must be an http:// or https:// URL, got ${raw}`);
  }
  if (url.username !== '' || url.password !== '') {
    throw new Error('ON_API_UPSTREAM must not contain credentials');
  }
  return url.origin;
}

/** `ON_API_MAPDB_UPSTREAM`, or null when `ON_API_MAPDB` switches the source off. */
function mapdbUpstreamSetting(env: Environment): string | null {
  const state = setting(env, 'ON_API_MAPDB');
  if (state === '0') return null;
  if (state !== null && state !== '1') throw new Error(`ON_API_MAPDB must be 0 or 1, got ${state}`);
  const raw = setting(env, 'ON_API_MAPDB_UPSTREAM') ?? DEFAULT_MAPDB_UPSTREAM;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`ON_API_MAPDB_UPSTREAM must be an http:// or https:// URL, got ${raw}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`ON_API_MAPDB_UPSTREAM must be an http:// or https:// URL, got ${raw}`);
  }
  if (url.username !== '' || url.password !== '') {
    throw new Error('ON_API_MAPDB_UPSTREAM must not contain credentials');
  }
  return url.origin;
}

function integerSetting(env: Environment, name: string, fallback: number, max: number): number {
  const raw = setting(env, name);
  if (raw === null) return fallback;
  const value = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isSafeInteger(value) || value < 1 || value > max) {
    throw new Error(`${name} must be an integer from 1 to ${max}, got ${raw}`);
  }
  return value;
}

function flagSetting(env: Environment, name: string): boolean {
  const raw = setting(env, name);
  if (raw === null || raw === '0') return false;
  if (raw === '1') return true;
  throw new Error(`${name} must be 0 or 1, got ${raw}`);
}

function originsSetting(env: Environment): readonly string[] {
  const raw = setting(env, 'API_REPORT_ORIGINS');
  if (raw === null) return DEFAULT_REPORT_ORIGINS;
  const origins = raw
    .split(',')
    .map((origin) => origin.trim().toLowerCase())
    .filter((origin) => origin !== '');
  for (const origin of origins) {
    if (!ORIGIN.test(origin)) {
      throw new Error(`API_REPORT_ORIGINS must list origins like scheme://host[:port], got ${origin}`);
    }
  }
  return origins;
}

function reportsConfig(env: Environment, cwd: string): ReportsConfig {
  const limit = (key: keyof ReportLimits): number => {
    const [name, fallback, max] = REPORT_LIMIT_SETTINGS[key];
    return integerSetting(env, name, fallback, max);
  };
  return {
    dir: resolve(cwd, setting(env, 'ON_API_REPORTS_DIR') ?? DEFAULT_REPORTS_DIR),
    trustForwardedFor: flagSetting(env, 'API_TRUST_FORWARDED_FOR'),
    origins: originsSetting(env),
    limits: {
      maxReportBytes: limit('maxReportBytes'),
      maxAddendumBytes: limit('maxAddendumBytes'),
      maxReportInflatedBytes: limit('maxReportInflatedBytes'),
      maxAddendumInflatedBytes: limit('maxAddendumInflatedBytes'),
      ipReportsPerHour: limit('ipReportsPerHour'),
      ipReportsPerDay: limit('ipReportsPerDay'),
      ipAddendaPerHour: limit('ipAddendaPerHour'),
      uploadsPerHour: limit('uploadsPerHour'),
      uploadBytesPerHour: limit('uploadBytesPerHour'),
      ipUploadBytesPerHour: limit('ipUploadBytesPerHour'),
      fingerprintPerDay: limit('fingerprintPerDay'),
      maxStoredBytes: limit('maxStoredBytes'),
      maxStoredReports: limit('maxStoredReports'),
    },
  };
}

function convertTimeoutSetting(env: Environment): number {
  const raw = setting(env, 'API_CONVERT_TIMEOUT_SECONDS');
  if (raw === null) return DEFAULT_CONVERT_TIMEOUT_SECONDS * MS_PER_SECOND;
  const seconds = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > MAX_CONVERT_TIMEOUT_SECONDS)
    throw new Error(
      `API_CONVERT_TIMEOUT_SECONDS must be an integer from 1 to ${MAX_CONVERT_TIMEOUT_SECONDS}`,
    );
  return seconds * MS_PER_SECOND;
}

/** `API_SYNC_INTERVAL`: whole seconds (`21600`) or a number with one unit `s`, `m`, `h` or `d` (`6h`). */
export function parseSyncInterval(raw: string): number {
  const match = /^(\d+)\s*([smhd]?)$/i.exec(raw);
  const unit = (match?.[2] || 's').toLowerCase() as IntervalUnit;
  const seconds = match?.[1] === undefined ? Number.NaN : Number(match[1]) * SECONDS_PER_UNIT[unit];
  if (
    !Number.isInteger(seconds) ||
    seconds < MIN_SYNC_INTERVAL_SECONDS ||
    seconds > MAX_SYNC_INTERVAL_SECONDS
  ) {
    throw new Error(
      `API_SYNC_INTERVAL must be seconds or a number with s, m, h or d, from ${MIN_SYNC_INTERVAL_SECONDS} s to ${MAX_SYNC_INTERVAL_SECONDS} s, got ${raw}`,
    );
  }
  return seconds * MS_PER_SECOND;
}

export function apiConfigFromEnvironment(env: Environment, cwd: string): ApiConfig {
  const interval = setting(env, 'API_SYNC_INTERVAL');
  return {
    port: portSetting(env),
    host: setting(env, 'HOST'),
    dataDir: resolve(cwd, setting(env, 'ON_API_DATA_DIR') ?? DEFAULT_DATA_DIR),
    upstream: upstreamSetting(env),
    mapdbUpstream: mapdbUpstreamSetting(env),
    syncIntervalMs:
      interval === null ? DEFAULT_SYNC_INTERVAL_SECONDS * MS_PER_SECOND : parseSyncInterval(interval),
    convertConcurrency: integerSetting(
      env,
      'API_CONVERT_CONCURRENCY',
      DEFAULT_CONVERT_CONCURRENCY,
      MAX_CONVERT_CONCURRENCY,
    ),
    convertTimeoutMs: convertTimeoutSetting(env),
    build: setting(env, 'API_BUILD'),
    reports: reportsConfig(env, cwd),
  };
}
