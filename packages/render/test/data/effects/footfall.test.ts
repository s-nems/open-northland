import { cellAnchorNode } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import {
  dustAlpha,
  footfallAt,
  footfallGround,
  footfallLogicTypes,
  printAlpha,
  stepHeadingDegrees,
  stepValency,
} from '../../../src/data/effects/index.js';

const MEADOW = 2;
const SAND = 4;
const SNOW = 7;
const BEACH = 8;
/** Pattern dictionary index = the logic type it resolves to. */
const LOGIC_TYPES = [0, 1, MEADOW, 3, SAND, 5, 6, SNOW, BEACH];

/** A one-row map whose cells carry the given (A, B) logic types. */
function row(cells: readonly (readonly [number, number])[]) {
  const ground = { patterns: [], a: cells.map(([a]) => a), b: cells.map(([, b]) => b) };
  return footfallGround(ground, LOGIC_TYPES, cells.length, 1);
}

describe('footfallAt', () => {
  it('keys on the cell triangles: snow on A, beach on both, sand on A', () => {
    const ground = row([
      [SNOW, MEADOW],
      [BEACH, BEACH],
      [BEACH, MEADOW],
      [SAND, MEADOW],
      [MEADOW, SNOW],
    ]);
    if (ground === null) throw new Error('footfall expected');
    const at = (cx: number) => {
      const node = cellAnchorNode(cx, 0);
      return footfallAt(ground, node.hx, node.hy);
    };
    expect([0, 1, 2, 3, 4].map(at)).toEqual(['snowSteps', 'beachSteps', undefined, 'dust', undefined]);
  });

  it('builds nothing for ground that leaves no footfall', () => {
    expect(row([[MEADOW, SNOW]])).toBeNull();
  });
});

describe('step heading', () => {
  it('turns clockwise from north on the staggered lattice', () => {
    expect(stepHeadingDegrees(4, 4, 4, 2)).toBe(0);
    expect(stepHeadingDegrees(4, 4, 5, 4)).toBe(90);
    expect(stepHeadingDegrees(4, 4, 4, 6)).toBe(180);
    expect(stepHeadingDegrees(4, 4, 3, 4)).toBe(270);
    // Odd rows sit half a node east: the step down onto (4, 5) heads south-east.
    expect(stepHeadingDegrees(4, 4, 4, 5)).toBe(153);
  });

  it('spreads the valencies over the full turn', () => {
    expect(stepValency(0, 14)).toBe(0);
    expect(stepValency(180, 14)).toBe(7);
    expect(stepValency(359, 14)).toBe(13);
  });
});

describe('printAlpha', () => {
  it('appears at three quarters and fades out over its shown life', () => {
    expect(printAlpha(0)).toBe(0.75);
    expect(printAlpha(60)).toBe(0.375);
    expect(printAlpha(120)).toBe(0);
  });
});

describe('dustAlpha', () => {
  it('starts faint and fades out over its frames', () => {
    expect(dustAlpha(0, 24)).toBe(0.6);
    expect(dustAlpha(12, 24)).toBeCloseTo(0.3);
    expect(dustAlpha(24, 24)).toBe(0);
  });
});

describe('footfallLogicTypes', () => {
  it('counts sand drawn with a snow texture as snow, and leaves other sand alone', () => {
    const types = footfallLogicTypes([
      { logicType: SNOW, texture: 'snow.pcx' },
      { logicType: SAND, texture: 'snow.pcx' },
      { logicType: SAND, texture: 'desert.pcx' },
      { logicType: MEADOW, texture: 'snow.pcx' },
    ]);
    expect(types).toEqual([SNOW, SNOW, SAND, MEADOW]);
  });
});
