import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { nodeVfs } from '@open-northland/vfs/node';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildBobsIndexEntries } from '../src/bobs-index.js';
import { makeTempDir, type TempDir } from './support/temp-dir.js';

describe('buildBobsIndexEntries', () => {
  const fs = nodeVfs();
  let tmp: TempDir;
  let bobsRoot: string;

  beforeEach(async () => {
    tmp = await makeTempDir('bobs-index');
    bobsRoot = tmp.path;
  });

  afterEach(() => tmp.cleanup());

  const atlas = (stem: string): Promise<void> =>
    writeFile(join(bobsRoot, `${stem}.atlas.json`), '{"width":1,"height":1,"frames":[]}');
  const png = (stem: string): Promise<void> => writeFile(join(bobsRoot, `${stem}.png`), 'png-bytes');

  it('lists viewable RGBA atlases split into base + variant, sorted', async () => {
    await atlas('ls_trees.tree_cypress01');
    await png('ls_trees.tree_cypress01');
    await atlas('ls_gui_window.iconsleft');
    await png('ls_gui_window.iconsleft');
    expect(await buildBobsIndexEntries(fs, bobsRoot)).toEqual([
      { stem: 'ls_gui_window.iconsleft', base: 'ls_gui_window', variant: 'iconsleft' },
      { stem: 'ls_trees.tree_cypress01', base: 'ls_trees', variant: 'tree_cypress01' },
    ]);
  });

  it('skips .indexed sheets (index-in-red, not viewable) and atlases with no matching png', async () => {
    await atlas('ls_gui_window.indexed');
    await png('ls_gui_window.indexed');
    await atlas('ls_goods.goods01');
    expect(await buildBobsIndexEntries(fs, bobsRoot)).toEqual([]);
  });
});
