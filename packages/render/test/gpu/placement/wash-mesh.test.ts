import { describe, expect, it } from 'vitest';
import { WashGeometry } from '../../../src/gpu/placement/wash-mesh.js';

function corners(shape: WashGeometry): number[] {
  return Array.from(shape.positions.subarray(0, shape.vertexCount * 2), (v) => v + 0);
}

describe('WashGeometry', () => {
  it('writes a diamond as two triangles over its four corners', () => {
    const shape = new WashGeometry();
    shape.diamond(10, 20, 4, 2);
    expect(corners(shape)).toEqual([10, 18, 14, 20, 10, 22, 6, 20]);
    expect(Array.from(shape.indices.subarray(0, shape.indexCount))).toEqual([0, 1, 2, 0, 2, 3]);
  });

  it('sweeps an ellipse along a row on its top and bottom, and along a diagonal on its tangents', () => {
    const row = new WashGeometry();
    row.sweep(0, 0, 34, 0, 24, 12);
    expect(corners(row)).toEqual([0, 12, 34, 12, 34, -12, 0, -12]);

    // Every corner lies on its ellipse, and the offset is tangent there: in the space where the ellipse
    // is a circle it is perpendicular to the line between the centres.
    const diagonal = new WashGeometry();
    diagonal.sweep(0, 0, 17, 19, 24, 12);
    const [x = Number.NaN, y = Number.NaN] = corners(diagonal);
    expect((x / 24) ** 2 + (y / 12) ** 2).toBeCloseTo(1, 6);
    expect(x * 17 + y * 2 * (19 * 2)).toBeCloseTo(0, 4);
  });

  it('keeps earlier shapes when its buffers grow, and indexes each shape from its own first vertex', () => {
    const shape = new WashGeometry();
    const capacity = shape.positions.length;
    shape.diamond(1, 2, 3, 4);
    while (shape.vertexCount * 2 <= capacity) shape.ellipse(0, 0, 5, 5);
    expect(shape.positions.length).toBeGreaterThan(capacity);
    expect(corners(shape).slice(0, 8)).toEqual([1, -2, 4, 2, 1, 6, -2, 2]);
    const used = shape.indices.subarray(0, shape.indexCount);
    expect(Math.max(...used)).toBe(shape.vertexCount - 1);

    shape.clear();
    expect([shape.vertexCount, shape.indexCount]).toEqual([0, 0]);
  });
});
