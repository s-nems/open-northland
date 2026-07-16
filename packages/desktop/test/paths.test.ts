import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readConfig, writeConfig } from '../src/config.js';
import { PORTABLE_DIR_NAME, resolveDataRoot } from '../src/paths.js';

/**
 * The data-root decision (`src/paths.ts`): env override → portable marker beside the executable →
 * dev repo root → per-user dir; and the config round-trip with its degrade-to-empty policy.
 */
describe('resolveDataRoot', () => {
  const base = {
    envOverride: undefined,
    execDir: '/opt/on/bin',
    userDataDir: '/home/u/.config/OpenNorthland',
    devRepoRoot: undefined,
    directoryExists: () => false,
  };

  it('prefers the env override over everything', () => {
    const root = resolveDataRoot({
      ...base,
      envOverride: '/tmp/e2e-data',
      devRepoRoot: '/repo',
      directoryExists: () => true,
    });
    expect(root).toEqual({ path: '/tmp/e2e-data', portable: false });
  });

  it('uses the portable marker dir next to the executable when it exists', () => {
    const marker = join('/opt/on/bin', PORTABLE_DIR_NAME);
    const root = resolveDataRoot({ ...base, directoryExists: (p) => p === marker });
    expect(root).toEqual({ path: marker, portable: true });
  });

  it('falls back to the dev repo root in an unpackaged run, else the per-user dir', () => {
    expect(resolveDataRoot({ ...base, devRepoRoot: '/repo' }).path).toBe('/repo');
    expect(resolveDataRoot(base)).toEqual({ path: base.userDataDir, portable: false });
  });
});

describe('desktop config', () => {
  it('round-trips the game path and degrades malformed/absent files to empty', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'opennorthland-desktop-config-'));
    try {
      const file = join(dir, 'nested', 'desktop-config.json');
      expect(readConfig(file)).toEqual({});
      writeConfig(file, { gamePath: 'C:\\Games\\Cultures' });
      expect(readConfig(file)).toEqual({ gamePath: 'C:\\Games\\Cultures' });
      writeConfig(file, {});
      expect(readConfig(file)).toEqual({});
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
