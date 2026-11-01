import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  apiConfigFromEnvironment,
  DEFAULT_MAPDB_UPSTREAM,
  DEFAULT_PORT,
  DEFAULT_REPORT_ORIGINS,
  DEFAULT_UPSTREAM,
  parseSyncInterval,
} from '../src/config.js';

const MS_PER_HOUR = 3_600_000;
const MIB = 1024 * 1024;
const SIX_HOURS = 6;

describe('apiConfigFromEnvironment', () => {
  it('defaults every setting', () => {
    expect(apiConfigFromEnvironment({}, '/checkout')).toEqual({
      port: DEFAULT_PORT,
      host: null,
      mapdbUpstream: DEFAULT_MAPDB_UPSTREAM,
      dataDir: resolve('/checkout', '.api-data'),
      upstream: DEFAULT_UPSTREAM,
      syncIntervalMs: SIX_HOURS * MS_PER_HOUR,
      convertConcurrency: 1,
      convertTimeoutMs: 120_000,
      build: null,
      reports: {
        dir: resolve('/checkout', '.api-reports'),
        trustForwardedFor: false,
        origins: DEFAULT_REPORT_ORIGINS,
        limits: {
          maxReportBytes: MIB / 2,
          maxAddendumBytes: 8 * MIB,
          maxReportInflatedBytes: 2 * MIB,
          maxAddendumInflatedBytes: 16 * MIB,
          ipReportsPerHour: 6,
          ipReportsPerDay: 20,
          ipAddendaPerHour: 6,
          uploadsPerHour: 200,
          uploadBytesPerHour: 256 * MIB,
          ipUploadBytesPerHour: 16 * MIB,
          fingerprintPerDay: 10,
          maxStoredBytes: 2048 * MIB,
          maxStoredReports: 20_000,
        },
      },
    });
  });

  it('reads and validates the report settings', () => {
    const { reports } = apiConfigFromEnvironment(
      {
        ON_API_REPORTS_DIR: '/reports',
        API_TRUST_FORWARDED_FOR: '1',
        API_REPORT_ORIGINS: 'https://Game.Example, app://game',
        API_REPORT_IP_HOURLY: '3',
      },
      '/checkout',
    );
    expect(reports).toMatchObject({
      dir: resolve('/reports'),
      trustForwardedFor: true,
      origins: ['https://game.example', 'app://game'],
      limits: { ipReportsPerHour: 3 },
    });
    expect(() => apiConfigFromEnvironment({ API_TRUST_FORWARDED_FOR: 'yes' }, '/')).toThrow(
      /API_TRUST_FORWARDED_FOR/,
    );
    expect(() => apiConfigFromEnvironment({ API_REPORT_ORIGINS: 'https://game.example/path' }, '/')).toThrow(
      /API_REPORT_ORIGINS/,
    );
    expect(() => apiConfigFromEnvironment({ API_REPORT_MAX_STORED: '0' }, '/')).toThrow(
      /API_REPORT_MAX_STORED/,
    );
  });

  it('reads and validates the environment', () => {
    const config = apiConfigFromEnvironment(
      {
        PORT: '9001',
        HOST: '127.0.0.1',
        ON_API_DATA_DIR: '/data',
        ON_API_UPSTREAM: 'http://localhost:1337/',
        API_BUILD: 'abc',
        API_CONVERT_CONCURRENCY: '3',
        API_CONVERT_TIMEOUT_SECONDS: '30',
      },
      '/checkout',
    );
    expect(config).toMatchObject({
      port: 9001,
      host: '127.0.0.1',
      dataDir: resolve('/data'),
      upstream: 'http://localhost:1337',
      mapdbUpstream: DEFAULT_MAPDB_UPSTREAM,
      build: 'abc',
      convertConcurrency: 3,
      convertTimeoutMs: 30_000,
    });
    expect(apiConfigFromEnvironment({ ON_API_MAPDB: '1' }, '/checkout').mapdbUpstream).toBe(
      DEFAULT_MAPDB_UPSTREAM,
    );
    expect(
      apiConfigFromEnvironment(
        { ON_API_MAPDB: '1', ON_API_MAPDB_UPSTREAM: 'http://mirror.example:8080/' },
        '/checkout',
      ).mapdbUpstream,
    ).toBe('http://mirror.example:8080');
    expect(apiConfigFromEnvironment({ ON_API_MAPDB: '0' }, '/checkout').mapdbUpstream).toBeNull();
    expect(() => apiConfigFromEnvironment({ ON_API_MAPDB: 'yes' }, '/')).toThrow(/ON_API_MAPDB/);
    expect(() =>
      apiConfigFromEnvironment({ ON_API_MAPDB: '1', ON_API_MAPDB_UPSTREAM: 'ftp://x' }, '/'),
    ).toThrow(/ON_API_MAPDB_UPSTREAM/);
    expect(() =>
      apiConfigFromEnvironment(
        { ON_API_MAPDB: '1', ON_API_MAPDB_UPSTREAM: 'https://user:secret@x' },
        '/',
      ),
    ).toThrow(/credentials/);
    expect(() => apiConfigFromEnvironment({ API_CONVERT_TIMEOUT_SECONDS: '0' }, '/')).toThrow(
      /API_CONVERT_TIMEOUT_SECONDS/,
    );
    expect(() => apiConfigFromEnvironment({ API_CONVERT_TIMEOUT_SECONDS: '601' }, '/')).toThrow(
      /API_CONVERT_TIMEOUT_SECONDS/,
    );
    expect(() => apiConfigFromEnvironment({ PORT: '70000' }, '/')).toThrow(/PORT/);
    expect(() => apiConfigFromEnvironment({ API_CONVERT_CONCURRENCY: '0' }, '/')).toThrow(
      /API_CONVERT_CONCURRENCY/,
    );
    expect(() => apiConfigFromEnvironment({ ON_API_UPSTREAM: 'ftp://x' }, '/')).toThrow(/ON_API_UPSTREAM/);
    expect(() => apiConfigFromEnvironment({ ON_API_UPSTREAM: 'https://user:secret@x' }, '/')).toThrow(
      /credentials/,
    );
  });
});

describe('parseSyncInterval', () => {
  it('accepts seconds or one unit', () => {
    expect(parseSyncInterval('21600')).toBe(SIX_HOURS * MS_PER_HOUR);
    expect(parseSyncInterval('6h')).toBe(SIX_HOURS * MS_PER_HOUR);
    expect(parseSyncInterval('360m')).toBe(SIX_HOURS * MS_PER_HOUR);
    expect(parseSyncInterval('1d')).toBe(4 * SIX_HOURS * MS_PER_HOUR);
  });

  it('refuses garbage and intervals out of range', () => {
    expect(() => parseSyncInterval('soon')).toThrow(/API_SYNC_INTERVAL/);
    expect(() => parseSyncInterval('5s')).toThrow(/API_SYNC_INTERVAL/);
    expect(() => parseSyncInterval('30d')).toThrow(/API_SYNC_INTERVAL/);
    expect(() => parseSyncInterval('1.5h')).toThrow(/API_SYNC_INTERVAL/);
  });
});
