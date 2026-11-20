import { describe, expect, it } from 'vitest';
import type { MapDatTerrainFile } from '../../src/terrain/index.js';
import { applyMapObjectEdits } from '../../src/terrain/object-edits.js';

const WALL = { type: 'wall_01', level: 100, owner: 6 };
const STONES = { type: 'stones', level: 1, owner: null };
/** A 2 x 2 cell map with a wall post at (0, 0) and stones at (2, 1). */
const TERRAIN = {
  width: 2,
  height: 2,
  objects: {
    types: ['wall_01', 'stones'],
    placements: [0, 0, 0, 2, 1, 1],
    levels: [100, 1],
    owners: [6, null],
  },
} as unknown as MapDatTerrainFile;
const fail = (why: string): never => {
  throw new Error(why);
};

describe('applyMapObjectEdits', () => {
  it('adds, replaces and removes objects, keeping row-major order', () => {
    const edited = applyMapObjectEdits(
      [
        { hx: 1, hy: 3, from: null, to: WALL },
        { hx: 2, hy: 1, from: STONES, to: WALL },
        { hx: 0, hy: 0, from: WALL, to: null },
      ],
      TERRAIN,
      fail,
    );
    expect(edited).toEqual({
      types: ['wall_01', 'stones'],
      placements: [2, 1, 0, 1, 3, 0],
      levels: [100, 100],
      owners: [6, 6],
    });
  });

  it('refuses an edit written for other objects, a node off the map and a type the map lacks', () => {
    const refused = (edit: Parameters<typeof applyMapObjectEdits>[0][number]) => () =>
      applyMapObjectEdits([edit], TERRAIN, fail);
    expect(refused({ hx: 0, hy: 0, from: STONES, to: null })).toThrow(/holds wall_01/);
    expect(refused({ hx: 4, hy: 0, from: null, to: WALL })).toThrow(/outside/);
    expect(refused({ hx: 1, hy: 1, from: null, to: { ...WALL, type: 'gate' } })).toThrow(/places no "gate"/);
  });
});
