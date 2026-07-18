import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readConfig, writeConfig } from '../src/config.js';
import { configFileOf, contentDirOf, modsDirOf } from '../src/paths.js';
import { createShellState, type ShellPaths } from '../src/shell-state.js';
import { makeTempDir, type TempDir } from './support/temp-dir.js';

/**
 * The shell's view of its own data root (`src/shell-state.ts`). Invariants: a hand-picked mod root
 * is re-validated on every read and a stale one is dropped from the config (without losing the
 * remembered game path), an installed mod under `mods/` is the fallback, and `desktopState` omits
 * absent optional keys rather than sending `undefined` over IPC.
 */
describe('createShellState', () => {
  let temp: TempDir;
  let paths: ShellPaths;

  beforeEach(async () => {
    temp = await makeTempDir('shell-state');
    paths = {
      dataRoot: { path: temp.path, portable: false },
      contentDir: contentDirOf(temp.path),
      configFile: configFileOf(temp.path),
      modsDir: modsDirOf(temp.path),
    };
  });

  afterEach(() => temp.cleanup());

  /** An unpacked mod root is any dir holding a `DataCnmd/` child. */
  async function makeModRoot(...segments: string[]): Promise<string> {
    const root = join(temp.path, ...segments);
    await mkdir(join(root, 'DataCnmd'), { recursive: true });
    return root;
  }

  describe('availableModRoot', () => {
    it('prefers a still-valid hand-picked mod root', async () => {
      const picked = await makeModRoot('elsewhere', 'CnMod');
      await makeModRoot('mods', 'CnMod 1.3.1');
      writeConfig(paths.configFile, { modPath: picked });

      expect(await createShellState(paths).availableModRoot()).toBe(picked);
      expect(readConfig(paths.configFile).modPath).toBe(picked);
    });

    it('drops a stale hand-picked root from the config and falls back to mods/', async () => {
      const installed = await makeModRoot('mods', 'CnMod 1.3.1');
      writeConfig(paths.configFile, { gamePath: '/somewhere/game', modPath: join(temp.path, 'deleted') });

      expect(await createShellState(paths).availableModRoot()).toBe(installed);
      const config = readConfig(paths.configFile);
      expect(config.modPath).toBeUndefined();
      // The stale-mod drop must not cost the user their remembered game folder.
      expect(config.gamePath).toBe('/somewhere/game');
    });

    it('is undefined with no config and no installed mod', async () => {
      expect(await createShellState(paths).availableModRoot()).toBeUndefined();
    });
  });

  describe('desktopState', () => {
    it('reports the data root and omits absent optional keys', async () => {
      const state = await createShellState(paths).desktopState();

      expect(state).toEqual({
        dataRoot: temp.path,
        portable: false,
        locale: 'eng',
        contentStatus: 'missing',
      });
      expect('gamePath' in state).toBe(false);
      expect('modRoot' in state).toBe(false);
    });

    it('carries the remembered game path and a discovered mod root', async () => {
      const installed = await makeModRoot('mods', 'CnMod 1.3.1');
      writeConfig(paths.configFile, { gamePath: '/somewhere/game' });

      const state = await createShellState(paths).desktopState();

      expect(state.gamePath).toBe('/somewhere/game');
      expect(state.modRoot).toBe(installed);
      expect(state.portable).toBe(false);
    });

    it('reports a portable data root', async () => {
      const state = await createShellState({
        ...paths,
        dataRoot: { path: temp.path, portable: true },
      }).desktopState();

      expect(state.portable).toBe(true);
    });
  });

  describe('contentStatus', () => {
    it('is missing on an unconverted data root', async () => {
      expect(await createShellState(paths).contentStatus()).toBe('missing');
    });
  });
});
