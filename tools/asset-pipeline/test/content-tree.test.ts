import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertDistinctBobBasenames,
  BOBS_DIR,
  bobAtlasStem,
  GUI_BITMAPS_DIR,
  MAPS_DIR,
  SOUNDS_DIR,
  TEXTURES_DIR,
} from '../src/stages/content-tree.js';

describe('served directory constants', () => {
  it('spell the URL roots the app fetches, since the tree is served as static files', () => {
    // Pinned as literals: a drift here 404s a whole route silently.
    expect([BOBS_DIR, TEXTURES_DIR, SOUNDS_DIR, GUI_BITMAPS_DIR, MAPS_DIR]).toEqual([
      'bobs',
      'textures',
      'sounds',
      'gui-bitmaps',
      'maps',
    ]);
  });
});

describe('bobAtlasStem', () => {
  it('drops the source directory and casing - the app addresses atlases by basename alone', () => {
    expect(bobAtlasStem(join('Data', 'engine2d', 'bin', 'bobs', 'ls_trees.bmd'), 'tree_yew01')).toBe(
      'ls_trees.tree_yew01',
    );
    expect(bobAtlasStem('data/engine2d/bin/bobs/nowe/f_bakery.bmd', 'ship_house')).toBe(
      'f_bakery.ship_house',
    );
    expect(bobAtlasStem(join('Data', 'Bobs', 'Body_S.BMD'), 'shadow')).toBe('body_s.shadow');
  });
});

describe('assertDistinctBobBasenames', () => {
  it('accepts repeated refs and distinct basenames across subdirectories', () => {
    expect(() =>
      assertDistinctBobBasenames([
        'data/engine2d/bin/bobs/mur.bmd',
        'data/engine2d/bin/bobs/nowe/f_bakery.bmd',
        'data/engine2d/bin/bobs/mur.bmd',
      ]),
    ).not.toThrow();
  });

  it('reports every colliding pair in one throw - a rerun costs a full conversion', () => {
    expect(() =>
      assertDistinctBobBasenames([
        'data/engine2d/bin/bobs/mur.bmd',
        'data/engine2d/bin/bobs/nowe/mur.bmd',
        'data/engine2d/bin/bobs/f_bakery.bmd',
        'data/engine2d/bin/bobs/test/f_bakery.bmd',
      ]),
    ).toThrow(/nowe\/mur\.bmd.*mur\.<suffix>.*test\/f_bakery\.bmd.*f_bakery\.<suffix>/s);
  });
});
