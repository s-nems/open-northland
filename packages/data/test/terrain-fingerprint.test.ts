import { describe, expect, it } from 'vitest';
import { terrainGridFingerprint } from '../src/index.js';

const GRID = { width: 2, height: 2, typeIds: [1, 2, 3, 4] };

describe('terrainGridFingerprint', () => {
  it('is stable for a pinned grid', () => {
    // A format contract: this exact value ends up in save headers, so a change here is a
    // compatibility break, not a refactor.
    expect(terrainGridFingerprint(GRID)).toBe('1110ba7d');
  });

  it('is independent of the backing array kind', () => {
    expect(terrainGridFingerprint({ ...GRID, typeIds: Int32Array.from(GRID.typeIds) })).toBe(
      terrainGridFingerprint(GRID),
    );
  });

  it('changes when one typeId changes', () => {
    expect(terrainGridFingerprint({ ...GRID, typeIds: [1, 2, 3, 5] })).not.toBe(terrainGridFingerprint(GRID));
  });

  it('distinguishes transposed dimensions over the same cells', () => {
    expect(terrainGridFingerprint({ width: 4, height: 1, typeIds: GRID.typeIds })).not.toBe(
      terrainGridFingerprint({ width: 1, height: 4, typeIds: GRID.typeIds }),
    );
  });

  it('rejects a grid with holes', () => {
    const holey = new Array<number>(3);
    holey[0] = 1;
    holey[2] = 3;
    expect(() => terrainGridFingerprint({ width: 3, height: 1, typeIds: holey })).toThrow('hole at index 1');
  });
});
