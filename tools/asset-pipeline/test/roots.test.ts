import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  collectSourceFiles,
  collectSourceFilesNamed,
  resolveSourceFile,
  rootsInOrder,
  type SourceRoots,
} from '../src/roots.js';
import { makeTempDir, type TempDir } from './support/game-tree.js';

describe('source roots', () => {
  let tmp: TempDir;
  let game: string;
  let mod: string;

  const write = async (root: string, rel: string, text: string): Promise<void> => {
    const path = join(root, rel);
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, text);
  };

  beforeEach(async () => {
    tmp = await makeTempDir('roots');
    game = join(tmp.path, 'game');
    mod = join(tmp.path, 'mod');
    await mkdir(game, { recursive: true });
    await mkdir(mod, { recursive: true });
  });

  afterEach(() => tmp.cleanup());

  describe('rootsInOrder', () => {
    it('puts the mod overlay first', () => {
      expect(rootsInOrder({ game, mod })).toEqual([mod, game]);
    });

    it('collapses to one root when the overlay is absent or the identity', () => {
      expect(rootsInOrder({ game, mod: undefined })).toEqual([game]);
      expect(rootsInOrder({ game, mod: game })).toEqual([game]);
    });
  });

  describe('resolveSourceFile', () => {
    it('prefers the overlay copy and falls back to the base game', async () => {
      const rel = join('Data', 'logic', 'goodtypes.ini');
      await write(game, rel, 'base');
      await write(mod, rel, 'overlay');
      const roots: SourceRoots = { game, mod };
      expect(await resolveSourceFile(roots, rel)).toBe(join(mod, rel));
      expect(await resolveSourceFile(roots, join('Data', 'logic', 'goodtypes.ini'))).toBe(join(mod, rel));
      await write(game, join('Data', 'base-only.ini'), 'base');
      expect(await resolveSourceFile(roots, join('Data', 'base-only.ini'))).toBe(
        join(game, 'Data', 'base-only.ini'),
      );
      expect(await resolveSourceFile(roots, join('Data', 'absent.ini'))).toBeUndefined();
    });
  });

  describe('collectSourceFilesNamed', () => {
    it('unions both trees with the overlay winning a relative-path collision', async () => {
      await write(game, join('Data', 'maps', 'shared', 'map.dat'), 'base');
      await write(game, join('Data', 'maps', 'base_only', 'map.dat'), 'base');
      await write(mod, join('Data', 'maps', 'shared', 'map.dat'), 'overlay');
      await write(mod, join('CnModMaps', 'mod_only', 'map.dat'), 'overlay');
      const found = await collectSourceFilesNamed({ game, mod }, 'map.dat');
      expect(found).toEqual([
        {
          rel: join('CnModMaps', 'mod_only', 'map.dat'),
          path: join(mod, 'CnModMaps', 'mod_only', 'map.dat'),
        },
        {
          rel: join('Data', 'maps', 'base_only', 'map.dat'),
          path: join(game, 'Data', 'maps', 'base_only', 'map.dat'),
        },
        {
          rel: join('Data', 'maps', 'shared', 'map.dat'),
          path: join(mod, 'Data', 'maps', 'shared', 'map.dat'),
        },
      ]);
    });

    it('matches the file name case-insensitively, including at the root level', async () => {
      await write(game, 'MAP.DAT', 'base');
      await write(game, join('deep', 'Map.Dat'), 'base');
      const found = await collectSourceFilesNamed({ game, mod: undefined }, 'map.dat');
      expect(found.map((f) => f.rel)).toEqual(['MAP.DAT', join('deep', 'Map.Dat')]);
    });

    it('visits an identity overlay once', async () => {
      await write(game, join('maps', 'x', 'map.dat'), 'base');
      const found = await collectSourceFilesNamed({ game, mod: game }, 'map.dat');
      expect(found).toHaveLength(1);
    });
  });

  describe('collectSourceFiles', () => {
    it('filters on the lower-cased relative path', async () => {
      await write(game, join('DataX', 'Libs', 'data0001.LIB'), 'base');
      await write(mod, join('DataX', 'Libs', 't.dat'), 'placeholder');
      const found = await collectSourceFiles({ game, mod }, (rel) => rel.endsWith('.lib'));
      expect(found.map((f) => f.rel)).toEqual([join('DataX', 'Libs', 'data0001.LIB')]);
    });
  });
});
