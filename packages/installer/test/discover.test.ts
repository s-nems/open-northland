import { vjoin } from '@open-northland/vfs';
import { memoryVfs } from '@open-northland/vfs/memory';
import { describe, expect, it } from 'vitest';
import {
  discoverInstalledMod,
  findModRootUnder,
  markComplete,
  markIncomplete,
} from '../src/mod-install/discover.js';

describe('mod root discovery', () => {
  it('finds the root at the dir itself or one level below, else undefined', async () => {
    const fs = memoryVfs();
    await fs.mkdir('direct/DataCnmd');
    expect(await findModRootUnder(fs, 'direct')).toBe('direct');
    await fs.mkdir('wrapped/CnMod 1.3.1/DataCnmd');
    expect(await findModRootUnder(fs, 'wrapped')).toBe('wrapped/CnMod 1.3.1');
    await fs.mkdir('empty');
    expect(await findModRootUnder(fs, 'empty')).toBeUndefined();
  });

  it('discovers the newest installed mod under mods/ (lexicographically last)', async () => {
    const fs = memoryVfs();
    expect(await discoverInstalledMod(fs, 'mods')).toBeUndefined(); // no mods/ dir yet
    await fs.mkdir('mods/CnMod 1.3.1/DataCnmd');
    await fs.mkdir('mods/CnMod 1.3.2/DataCnmd');
    await fs.mkdir('mods/not-a-mod');
    expect(await discoverInstalledMod(fs, 'mods')).toBe('mods/CnMod 1.3.2');
  });

  it('treats a mod still carrying the incomplete marker as absent', async () => {
    const fs = memoryVfs();
    const root = vjoin('mods', 'CnMod 1.3.1');
    await fs.mkdir(vjoin(root, 'DataCnmd'));
    await markIncomplete(fs, root);
    expect(await discoverInstalledMod(fs, 'mods')).toBeUndefined();
    await markComplete(fs, root);
    expect(await discoverInstalledMod(fs, 'mods')).toBe(root);
  });
});
