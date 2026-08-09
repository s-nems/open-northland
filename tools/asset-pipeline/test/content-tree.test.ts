import { join } from 'node:path';
import { vjoin } from '@open-northland/vfs';
import { describe, expect, it } from 'vitest';
import {
  assertDistinctBobBasenames,
  BOBS_DIR,
  bobAtlasStem,
  GUI_BITMAPS_DIR,
  SOUNDS_DIR,
  servedRelPath,
  TEXTURES_DIR,
} from '../src/stages/content-tree.js';

describe('served subtree constants', () => {
  it('spell the four roots the content routes serve (packages/content-resolver FILE_ROUTES)', () => {
    // Pinned as literals, not rebuilt from the constants: a drift here 404s a whole route silently.
    expect([BOBS_DIR, TEXTURES_DIR, SOUNDS_DIR, GUI_BITMAPS_DIR]).toEqual([
      'Data/engine2d/bin/bobs',
      'Data/engine2d/bin/textures',
      'Data/engine2d/bin/sounds',
      'Data/gui/bitmaps',
    ]);
  });
});

describe('servedRelPath', () => {
  it('rewrites a served subtree to the route spelling, whatever the winning layer spelled', () => {
    // The content routes match case-sensitively, so these all have to collapse onto one output tree.
    expect(servedRelPath(join('data', 'engine2d', 'bin', 'textures', 'tran_meadow.png'))).toBe(
      vjoin(TEXTURES_DIR, 'tran_meadow.png'),
    );
    expect(servedRelPath(join('Data', 'Engine2D', 'Bin', 'Bobs', 'Ls_Trees.bmd'))).toBe(
      vjoin(BOBS_DIR, 'ls_trees.bmd'),
    );
    expect(servedRelPath(join('DATA', 'GUI', 'BITMAPS', 'Bg_Normal.png'))).toBe(
      vjoin(GUI_BITMAPS_DIR, 'bg_normal.png'),
    );
  });

  it('lower-cases the whole tail, subdirectories included (`/sounds/<file>` joins on it)', () => {
    expect(servedRelPath(join('Data', 'engine2d', 'bin', 'sounds', 'GUI', 'Click.wav'))).toBe(
      vjoin(SOUNDS_DIR, 'gui', 'click.wav'),
    );
  });

  it('passes through a path no route addresses, and a served root with no file under it', () => {
    expect(servedRelPath(join('DataCnmd', 'Bramy', 'Wall.bmd'))).toBe(join('DataCnmd', 'Bramy', 'Wall.bmd'));
    expect(servedRelPath(join('Data', 'maps', 'WICHRY_ZIMY', 'map.dat'))).toBe(
      join('Data', 'maps', 'WICHRY_ZIMY', 'map.dat'),
    );
    expect(servedRelPath(BOBS_DIR)).toBe(BOBS_DIR);
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
