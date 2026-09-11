import { GfxPattern, type TerrainMapFile } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { ownGrassBindings, ownMapPatch } from '../src/entries/art-review/map-patch.js';

const row = GfxPattern.parse({
  id: 0,
  editName: 'synthetic meadow',
  texture: 'data/engine2d/bin/textures/text_224.pcx',
  coordsA: [0, 0, 63, 63, 0, 63],
  coordsB: [0, 0, 63, 0, 63, 63],
});
const bindings = ownGrassBindings([row], 512, 512);
const values = Array.from({ length: 48 }, (_, index) => index);
const map: TerrainMapFile = {
  width: 6,
  height: 8,
  typeIds: values,
  ground: { patterns: ['unused', 'synthetic meadow'], a: values.map(() => 1), b: values.map(() => 1) },
  transitions: {
    types: ['synthetic overlay'],
    a1: values.map(() => 255),
    a2: values.map(() => 255),
    b1: values.map(() => 255),
    b2: values.map(() => 255),
  },
  elevation: values,
  brightness: values,
};
const area = { x: 1, y: 2, width: 2, height: 2 };

describe('own-art map patch', () => {
  it('preserves lane values and dictionary indices without mutating the source map', () => {
    const before = JSON.stringify(map);
    const patch = ownMapPatch(map, area, bindings);
    expect(patch.terrain.typeIds).toEqual([13, 14, 19, 20]);
    expect(patch.terrain.elevation).toEqual([13, 14, 19, 20]);
    expect(patch.terrain.brightness).toEqual([13, 14, 19, 20]);
    expect(patch.terrain.ground).toEqual({
      patterns: ['unused', 'synthetic meadow'],
      a: [1, 1, 1, 1],
      b: [1, 1, 1, 1],
    });
    expect(patch.terrain.transitions?.a1).toEqual([255, 255, 255, 255]);
    expect(JSON.stringify(map)).toBe(before);
  });
  it('scales source pixel coordinates to the own page dimensions', () => {
    expect(bindings.get('synthetic meadow')?.coordsA).toEqual([0, 0, 126, 126, 0, 126]);
    expect(bindings.get('synthetic meadow')?.pageKey).toBe('own-grass');
  });
  it('rejects unsupported patterns and active overlays instead of hiding them', () => {
    expect(() => ownMapPatch(map, area, new Map())).toThrow('Unsupported ground patterns');
    const transitions = map.transitions;
    if (!transitions) throw new Error('Missing fixture transitions');
    const a1 = [...transitions.a1];
    a1[13] = 0;
    expect(() => ownMapPatch({ ...map, transitions: { ...transitions, a1 } }, area, bindings)).toThrow(
      'transition overlays',
    );
  });
  it('rejects invalid bounds and odd starting rows', () => {
    for (const changed of [{ y: 3 }, { x: 5 }, { width: 0 }, { x: 1.5 }, { y: -2 }]) {
      expect(() => ownMapPatch(map, { ...area, ...changed }, bindings)).toThrow('Invalid patch bounds');
    }
  });
});
