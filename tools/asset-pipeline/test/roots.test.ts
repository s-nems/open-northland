import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  collectSourceFiles,
  collectSourceFilesNamed,
  findPathCaseInsensitive,
  pickCaseFoldedEntry,
  resolveSourceFile,
  rootsInOrder,
  type SourceRoots,
  unionCaseFoldedRoots,
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

  describe('pickCaseFoldedEntry', () => {
    it('prefers the exact spelling, else the single case-folded match', () => {
      expect(pickCaseFoldedEntry(['Text', 'other'], 'Text', 'd')).toBe('Text');
      expect(pickCaseFoldedEntry(['Text', 'other'], 'text', 'd')).toBe('Text');
      expect(pickCaseFoldedEntry(['Text'], 'missing', 'd')).toBeUndefined();
    });

    it('picks the exact ask among case twins, and throws when no exact spelling disambiguates', () => {
      // Twins can only coexist on a case-sensitive filesystem; the pure matcher pins the rule everywhere.
      expect(pickCaseFoldedEntry(['TEXT', 'Text'], 'Text', 'd')).toBe('Text');
      expect(() => pickCaseFoldedEntry(['TEXT', 'Text'], 'text', 'd')).toThrow(/case-colliding entries/);
    });
  });

  /**
   * Portability guard for the segment-wise resolution (the shipped trees mix `Text/`/`TEXT/`/`Pol/`/
   * `Strings.ini` casing freely; a case-sensitive Linux CI must still find them). These build a REAL
   * temp tree and resolve against it; the twin tie-break is pinned by the pure matcher above.
   */
  describe('findPathCaseInsensitive', () => {
    it('resolves an exactly-cased path', async () => {
      await write(game, join('text', 'strings.ini'), 'x');
      expect(await findPathCaseInsensitive(game, ['text', 'strings.ini'])).toBe(
        join(game, 'text', 'strings.ini'),
      );
    });

    it('matches each segment case-insensitively and returns the real on-disk casing', async () => {
      await write(game, join('Text', 'Strings.ini'), 'x');
      expect(await findPathCaseInsensitive(game, ['text', 'strings.ini'])).toBe(
        join(game, 'Text', 'Strings.ini'),
      );
    });

    it('resolves a multi-segment nested path', async () => {
      await mkdir(join(game, 'MISSION', 'POL'), { recursive: true });
      expect(await findPathCaseInsensitive(game, ['mission', 'pol'])).toBe(join(game, 'MISSION', 'POL'));
    });

    it('is undefined when a segment or the base directory is absent', async () => {
      await mkdir(join(game, 'text'), { recursive: true });
      expect(await findPathCaseInsensitive(game, ['text', 'missing.ini'])).toBeUndefined();
      expect(await findPathCaseInsensitive(join(game, 'nope'), ['anything'])).toBeUndefined();
    });

    it('returns the directory itself for an empty segment list', async () => {
      expect(await findPathCaseInsensitive(game, [])).toBe(game);
    });
  });

  describe('resolveSourceFile', () => {
    it('prefers the overlay copy and falls back to the base game', async () => {
      const rel = join('Data', 'logic', 'goodtypes.ini');
      await write(game, rel, 'base');
      await write(mod, rel, 'overlay');
      const roots: SourceRoots = { game, mod };
      expect(await resolveSourceFile(roots, rel)).toBe(join(mod, rel));
      await write(game, join('Data', 'base-only.ini'), 'base');
      expect(await resolveSourceFile(roots, join('Data', 'base-only.ini'))).toBe(
        join(game, 'Data', 'base-only.ini'),
      );
      expect(await resolveSourceFile(roots, join('Data', 'absent.ini'))).toBeUndefined();
    });

    it('resolves every path segment case-insensitively to the real on-disk casing', async () => {
      await write(game, join('Data', 'logic', 'goodtypes.ini'), 'base');
      expect(await resolveSourceFile({ game, mod: undefined }, join('data', 'LOGIC', 'GoodTypes.INI'))).toBe(
        join(game, 'Data', 'logic', 'goodtypes.ini'),
      );
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

    it('collapses a case-divergent spelling of the same path (overlay wins, like an over-install)', async () => {
      await write(game, join('Data', 'Maps', 'shared', 'map.dat'), 'base');
      await write(mod, join('data', 'maps', 'shared', 'map.dat'), 'overlay');
      const found = await collectSourceFilesNamed({ game, mod }, 'map.dat');
      expect(found).toEqual([
        {
          rel: join('data', 'maps', 'shared', 'map.dat'),
          path: join(mod, 'data', 'maps', 'shared', 'map.dat'),
        },
      ]);
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

  describe('unionCaseFoldedRoots', () => {
    const file = (root: string, rel: string): { rel: string; path: string } => ({
      rel,
      path: join(root, rel),
    });

    it('keys on the case-folded path: an earlier root wins, spelling differences included', () => {
      const union = unionCaseFoldedRoots([
        { root: '/m', files: [file('/m', join('data', 'a.pcx'))] },
        { root: '/g', files: [file('/g', join('Data', 'A.PCX')), file('/g', join('Data', 'b.pcx'))] },
      ]);
      expect(union).toEqual([
        { rel: join('Data', 'b.pcx'), path: join('/g', 'Data', 'b.pcx') },
        { rel: join('data', 'a.pcx'), path: join('/m', 'data', 'a.pcx') },
      ]);
    });

    it('throws on two same-root paths that differ only in case (no over-install merges them)', () => {
      expect(() =>
        unionCaseFoldedRoots([
          { root: '/g', files: [file('/g', join('Data', 'x.pcx')), file('/g', join('data', 'X.PCX'))] },
        ]),
      ).toThrow(/case-colliding sources .* under \/g/);
    });
  });
});
