import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildBobsIndexEntries } from '../src/bobs-index.js';

/**
 * The `/bobs-index` scan (`src/bobs-index.ts`): the list the `?icons` gallery browses.
 * Invariants: only VIEWABLE RGBA atlases (a `<stem>.atlas.json` WITH a matching `<stem>.png`, and NOT
 * an `.indexed` sheet) are listed, split into base + palette variant, sorted by (base, variant).
 */
describe('buildBobsIndexEntries', () => {
  let bobsRoot: string;

  beforeEach(async () => {
    bobsRoot = await mkdtemp(join(tmpdir(), 'opennorthland-bobs-index-'));
  });

  afterEach(async () => {
    await rm(bobsRoot, { recursive: true, force: true });
  });

  const atlas = (stem: string): Promise<void> =>
    writeFile(join(bobsRoot, `${stem}.atlas.json`), '{"width":1,"height":1,"frames":[]}');
  const png = (stem: string): Promise<void> => writeFile(join(bobsRoot, `${stem}.png`), 'png-bytes');

  it('lists viewable RGBA atlases split into base + variant, sorted', async () => {
    await atlas('ls_trees.tree_cypress01');
    await png('ls_trees.tree_cypress01');
    await atlas('ls_gui_window.iconsleft');
    await png('ls_gui_window.iconsleft');
    expect(buildBobsIndexEntries(bobsRoot)).toEqual([
      { stem: 'ls_gui_window.iconsleft', base: 'ls_gui_window', variant: 'iconsleft' },
      { stem: 'ls_trees.tree_cypress01', base: 'ls_trees', variant: 'tree_cypress01' },
    ]);
  });

  it('skips .indexed sheets (index-in-red, not viewable) and atlases with no matching png', async () => {
    await atlas('ls_gui_window.indexed'); // recolour source, not viewable
    await png('ls_gui_window.indexed');
    await atlas('ls_goods.goods01'); // atlas.json but no png → not viewable
    expect(buildBobsIndexEntries(bobsRoot)).toEqual([]);
  });
});
