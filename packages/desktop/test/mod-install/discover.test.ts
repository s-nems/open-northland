import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { discoverInstalledMod, findModRootUnder } from '../../src/mod-install/discover.js';
import { makeTempDir, type TempDir } from '../support/temp-dir.js';

describe('mod root discovery', () => {
  let tmp: TempDir;
  beforeEach(async () => {
    tmp = await makeTempDir('mod-discovery');
  });
  afterEach(() => tmp.cleanup());

  it('finds the root at the dir itself or one level below, else undefined', async () => {
    await mkdir(join(tmp.path, 'direct', 'DataCnmd'), { recursive: true });
    expect(await findModRootUnder(join(tmp.path, 'direct'))).toBe(join(tmp.path, 'direct'));
    await mkdir(join(tmp.path, 'wrapped', 'CnMod 1.3.1', 'DataCnmd'), { recursive: true });
    expect(await findModRootUnder(join(tmp.path, 'wrapped'))).toBe(join(tmp.path, 'wrapped', 'CnMod 1.3.1'));
    await mkdir(join(tmp.path, 'empty'), { recursive: true });
    expect(await findModRootUnder(join(tmp.path, 'empty'))).toBeUndefined();
  });

  it('discovers the newest installed mod under mods/ (lexicographically last)', async () => {
    const mods = join(tmp.path, 'mods');
    expect(await discoverInstalledMod(mods)).toBeUndefined(); // no mods/ dir yet
    await mkdir(join(mods, 'CnMod 1.3.1', 'DataCnmd'), { recursive: true });
    await mkdir(join(mods, 'CnMod 1.3.2', 'DataCnmd'), { recursive: true });
    await mkdir(join(mods, 'not-a-mod'), { recursive: true });
    expect(await discoverInstalledMod(mods)).toBe(join(mods, 'CnMod 1.3.2'));
  });
});
