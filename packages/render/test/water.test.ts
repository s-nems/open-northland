import { describe, expect, it } from 'vitest';
import type { SceneGround } from '../src/data/scene/index.js';
import { cellNode, makeWaterField, NO_WATER } from '../src/data/terrain/index.js';

const MEADOW = 0;
const DEEP = 1;
const SHALLOW = 2;

/** A width×height ground layer drawing `patternOf(cell)` on both triangles, or a `[a, b]` pair. */
function groundOf(
  width: number,
  height: number,
  patternOf: (cell: number) => number | readonly [number, number],
): SceneGround {
  const cells = width * height;
  const a = new Array<number>(cells);
  const b = new Array<number>(cells);
  for (let i = 0; i < cells; i++) {
    const p = patternOf(i);
    [a[i], b[i]] = typeof p === 'number' ? [p, p] : p;
  }
  return { patterns: ['block meadow 00', 'block water 01', 'block water shallow 02'], a, b };
}

describe('makeWaterField', () => {
  it('returns the shared still field without ground lanes or without any water pattern', () => {
    expect(makeWaterField(undefined, 4, 4)).toBe(NO_WATER);
    expect(
      makeWaterField(
        groundOf(4, 4, () => MEADOW),
        4,
        4,
      ),
    ).toBe(NO_WATER);
  });

  it('bobs 1 deep inside water and 0 on any node a land triangle can reach', () => {
    // A 7×7 grid whose central 5×5 is water: only the very centre cell has a full 3×3 water
    // neighbourhood, so only its centre node carries full amplitude.
    const inPond = (cell: number): boolean => {
      const r = Math.floor(cell / 7);
      const c = cell % 7;
      return r >= 1 && r <= 5 && c >= 1 && c <= 5;
    };
    const { wave } = makeWaterField(
      groundOf(7, 7, (cell) => (inPond(cell) ? DEEP : MEADOW)),
      7,
      7,
    );
    expect(wave(...cellNode(3, 3))).toBe(1);
    // A cell one ring out from the centre touches land in its 3×3 neighbourhood → still.
    expect(wave(...cellNode(1, 1))).toBe(0);
    // Land node far from water: still.
    expect(wave(...cellNode(0, 6))).toBe(0);
  });

  it('shades by the painted family: shallows are surface only, deep water both, a mixed cell half', () => {
    // Row-major 4×1: land | shallow | deep | one shallow and one deep triangle.
    const field = makeWaterField(
      groundOf(4, 1, (cell) => [MEADOW, SHALLOW, DEEP, [SHALLOW, DEEP] as const][cell] ?? MEADOW),
      4,
      1,
    );
    const at = (col: number): readonly [number, number] => [
      field.surface(...cellNode(col, 0)),
      field.deep(...cellNode(col, 0)),
    ];
    expect(at(0)).toEqual([0, 0]);
    expect(at(1)).toEqual([1, 0]);
    expect(at(2)).toEqual([1, 1]);
    expect(at(3)).toEqual([1, 0.5]);
  });

  it('counts a half-water cell as half surface and keeps it still', () => {
    const field = makeWaterField(
      groundOf(3, 3, (cell) => (cell === 4 ? ([MEADOW, DEEP] as const) : MEADOW)),
      3,
      3,
    );
    expect(field.surface(...cellNode(1, 1))).toBe(0.5);
    expect(field.deep(...cellNode(1, 1))).toBe(0.5);
    expect(field.wave(...cellNode(1, 1))).toBe(0);
  });
});
