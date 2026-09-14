import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { vjoin, writeText } from '@open-northland/vfs';
import { memoryVfs } from '@open-northland/vfs/memory';
import { nodeVfs } from '@open-northland/vfs/node';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  collectSourceFiles,
  collectSourceFilesNamed,
  findPathCaseInsensitive,
  pickCaseFoldedEntry,
  resolveSourceFile,
  type SourceRoots,
} from '../src/roots.js';
import { makeTempDir, type TempDir } from './support/game-tree.js';

const fs = nodeVfs();

describe('source roots', () => {
  let tmp: TempDir;
  let game: string;

  const write = async (root: string, rel: string, text: string): Promise<void> => {
    const path = join(root, rel);
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, text);
  };

  beforeEach(async () => {
    tmp = await makeTempDir('roots');
    game = join(tmp.path, 'game');
    await mkdir(game, { recursive: true });
  });

  afterEach(() => tmp.cleanup());

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
      expect(await findPathCaseInsensitive(fs, game, ['text', 'strings.ini'])).toBe(
        vjoin(game, 'text', 'strings.ini'),
      );
    });

    it('matches each segment case-insensitively and returns the real on-disk casing', async () => {
      await write(game, join('Text', 'Strings.ini'), 'x');
      expect(await findPathCaseInsensitive(fs, game, ['text', 'strings.ini'])).toBe(
        vjoin(game, 'Text', 'Strings.ini'),
      );
    });

    it('resolves a multi-segment nested path', async () => {
      await mkdir(join(game, 'MISSION', 'POL'), { recursive: true });
      expect(await findPathCaseInsensitive(fs, game, ['mission', 'pol'])).toBe(vjoin(game, 'MISSION', 'POL'));
    });

    it('is undefined when a segment or the base directory is absent', async () => {
      await mkdir(join(game, 'text'), { recursive: true });
      expect(await findPathCaseInsensitive(fs, game, ['text', 'missing.ini'])).toBeUndefined();
      expect(await findPathCaseInsensitive(fs, join(game, 'nope'), ['anything'])).toBeUndefined();
    });

    it('returns the directory itself for an empty segment list', async () => {
      expect(await findPathCaseInsensitive(fs, game, [])).toBe(game);
    });
  });

  describe('resolveSourceFile', () => {
    it('resolves a present file and is undefined for an absent one', async () => {
      const rel = 'Data/logic/goodtypes.ini';
      await write(game, rel, 'x');
      const roots: SourceRoots = { mod: game };
      expect(await resolveSourceFile(fs, roots, rel)).toBe(vjoin(game, rel));
      expect(await resolveSourceFile(fs, roots, join('Data', 'absent.ini'))).toBeUndefined();
    });

    it('resolves every path segment case-insensitively to the real on-disk casing', async () => {
      await write(game, join('Data', 'logic', 'goodtypes.ini'), 'base');
      expect(await resolveSourceFile(fs, { mod: game }, join('data', 'LOGIC', 'GoodTypes.INI'))).toBe(
        vjoin(game, 'Data', 'logic', 'goodtypes.ini'),
      );
    });

    // Callers pass both shapes on every platform: `join`ed constants carry the platform separator,
    // ini-borne references arrive forward-slashed from `normalizeAssetPath`. Splitting on the
    // platform `sep` alone silently missed the other shape (armor rows degraded on Windows only).
    it('splits either separator, whichever the caller built the reference with', async () => {
      await write(game, join('Data', 'logic', 'goodtypes.ini'), 'base');
      const roots: SourceRoots = { mod: game };
      const resolved = vjoin(game, 'Data', 'logic', 'goodtypes.ini');
      expect(await resolveSourceFile(fs, roots, 'data/logic/goodtypes.ini')).toBe(resolved);
      expect(await resolveSourceFile(fs, roots, 'data\\logic\\goodtypes.ini')).toBe(resolved);
    });
  });

  describe('collectSourceFilesNamed', () => {
    it('lists every match sorted by relative path', async () => {
      await write(game, join('Data', 'maps', 'shared', 'map.dat'), 'x');
      await write(game, join('CnModMaps', 'mod_only', 'map.dat'), 'x');
      const found = await collectSourceFilesNamed(fs, { mod: game }, 'map.dat');
      expect(found).toEqual([
        { rel: 'CnModMaps/mod_only/map.dat', path: vjoin(game, 'CnModMaps', 'mod_only', 'map.dat') },
        { rel: 'Data/maps/shared/map.dat', path: vjoin(game, 'Data', 'maps', 'shared', 'map.dat') },
      ]);
    });

    it('matches the file name case-insensitively, including at the root level', async () => {
      await write(game, 'MAP.DAT', 'base');
      await write(game, join('deep', 'Map.Dat'), 'base');
      const found = await collectSourceFilesNamed(fs, { mod: game }, 'map.dat');
      expect(found.map((f) => f.rel)).toEqual(['MAP.DAT', 'deep/Map.Dat']);
    });
  });

  describe('collectSourceFiles', () => {
    it('filters on the lower-cased relative path', async () => {
      await write(game, join('DataX', 'Libs', 'data0001.LIB'), 'x');
      await write(game, join('DataX', 'Libs', 't.dat'), 'placeholder');
      const found = await collectSourceFiles(fs, { mod: game }, (rel) => rel.endsWith('.lib'));
      expect(found.map((f) => f.rel)).toEqual(['DataX/Libs/data0001.LIB']);
    });

    it('throws on two paths that differ only in case (a case-insensitive filesystem could serve either)', async () => {
      // Only a case-sensitive tree can hold both spellings, so the in-memory adapter stands in.
      const twins = memoryVfs();
      await writeText(twins, 'mod/Data/x.pcx', 'x');
      await writeText(twins, 'mod/data/X.PCX', 'x');
      await expect(collectSourceFiles(twins, { mod: 'mod' }, (rel) => rel.endsWith('.pcx'))).rejects.toThrow(
        /case-colliding sources .* under mod/,
      );
    });
  });
});
